import { resolve4 } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredDomains = [
  "WT_STAGING_APP_DOMAIN",
  "WT_STAGING_RTC_DOMAIN",
  "WT_STAGING_TURN_DOMAIN",
];

const requiredSecrets = {
  LIVEKIT_REDIS_PASSWORD: 24,
  LIVEKIT_API_KEY: 8,
  LIVEKIT_API_SECRET: 32,
  FEEDBACK_ADMIN_TOKEN: 32,
};

const placeholderPattern =
  /^(?:example|placeholder|replace|change-me|todo)(?:[-_.]|$)/i;
const knownInsecureSecrets = new Set([
  "spectemus_simul_redis_dev_only",
  "devkey",
  "devsecretdevsecretdevsecretdevsecret",
]);

export function parseEnvironment(source) {
  const values = {};

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new Error(`Некорректная строка env ${index + 1}.`);
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (/^['\"]/.test(value)) {
      const quote = value.at(0);
      if (!value.endsWith(quote) || value.length < 2) {
        throw new Error(`Незакрытая кавычка в строке env ${index + 1}.`);
      }
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }

    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Недопустимое имя переменной ${JSON.stringify(key)}.`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`Переменная ${key} задана дважды.`);
    }
    values[key] = value;
  }

  return values;
}

export function validateConfiguration(values) {
  const problems = [];
  const domains = requiredDomains.map((key) => {
    const value = values[key]?.trim().toLowerCase();
    if (!value) {
      problems.push(`${key} не задан.`);
      return { key, value: null };
    }
    if (!isPublicHostname(value)) {
      problems.push(`${key} должен быть публичным DNS-именем, а не ${value}.`);
    }
    return { key, value };
  });

  const configuredDomains = domains.flatMap(({ value }) =>
    value ? [value] : [],
  );
  if (new Set(configuredDomains).size !== configuredDomains.length) {
    problems.push("Домены app, rtc и turn должны быть разными.");
  }

  for (const [key, minimumLength] of Object.entries(requiredSecrets)) {
    const value = values[key];
    if (!value) {
      problems.push(`${key} не задан.`);
      continue;
    }
    if (value.length < minimumLength || isPlaceholder(value)) {
      problems.push(
        `${key} выглядит как sample-значение или слишком короткий секрет.`,
      );
    }
  }

  return { domains, problems };
}

export async function verifyDns(domains, expectedAddress, resolver = resolve4) {
  const problems = [];
  for (const { key, value } of domains) {
    if (!value) {
      continue;
    }

    try {
      const addresses = await resolver(value);
      if (!addresses.includes(expectedAddress)) {
        problems.push(
          `${key} (${value}) должен указывать на ${expectedAddress}, получено: ${addresses.join(", ") || "нет A-записи"}.`,
        );
      }
    } catch (error) {
      problems.push(
        `${key} (${value}) не удалось проверить через DNS: ${error.code ?? error.message}.`,
      );
    }
  }
  return problems;
}

export function isPublicIpv4(value) {
  const parts = value.split(".").map(Number);
  if (!isIpv4Parts(parts)) {
    return false;
  }

  const [first, second] = parts;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0)
  );
}

function isPublicHostname(value) {
  return (
    value.length <= 253 &&
    !value.endsWith(".") &&
    value.includes(".") &&
    !isIpv4(value) &&
    !value.split(".").every((label) => /^\d+$/.test(label)) &&
    !value.endsWith(".example") &&
    !value.endsWith(".example.com") &&
    !value.endsWith(".invalid") &&
    !value.endsWith(".localhost") &&
    !value.endsWith(".test") &&
    value
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

function isIpv4(value) {
  return isIpv4Parts(value.split(".").map(Number));
}

function isIpv4Parts(parts) {
  return (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  );
}

function isPlaceholder(value) {
  return (
    placeholderPattern.test(value) ||
    knownInsecureSecrets.has(value) ||
    value.includes("<") ||
    value.includes(">")
  );
}

async function main(args) {
  const options = parseArguments(args);
  const source = await readFile(options.envFile, "utf8");
  const values = parseEnvironment(source);
  const result = validateConfiguration(values);

  if (options.verifyDns && result.problems.length === 0) {
    result.problems.push(
      ...(await verifyDns(result.domains, options.publicIpv4)),
    );
  }

  if (result.problems.length > 0) {
    for (const problem of result.problems) {
      console.error(`[FAIL] ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[ok] protected staging env contains no sample values");
  console.log("[ok] app, rtc and turn use three distinct public domains");
  if (options.verifyDns) {
    console.log(`[ok] all staging A-records point to ${options.publicIpv4}`);
  } else {
    console.log(
      "[warn] DNS not checked; rerun with --verify-dns before public startup",
    );
  }
  console.log(
    "Preflight passed. This does not expose the service or replace the required TLS/TURN smoke run.",
  );
}

export function parseArguments(args) {
  const normalizedArgs = args.at(0) === "--" ? args.slice(1) : args;
  let envFile;
  let publicIpv4;
  let verifyDns = false;

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const argument = normalizedArgs[index];
    if (argument === "--env-file") {
      envFile = normalizedArgs[++index];
    } else if (argument === "--public-ipv4") {
      publicIpv4 = normalizedArgs[++index];
    } else if (argument === "--verify-dns") {
      verifyDns = true;
    } else {
      throw new Error(`Неизвестный аргумент ${argument}.`);
    }
  }

  if (!envFile) {
    throw new Error(
      "Укажите защищённый файл: --env-file /opt/spectemus-simul/.env",
    );
  }
  if (verifyDns && !isPublicIpv4(publicIpv4 ?? "")) {
    throw new Error("Для --verify-dns укажите публичный IPv4 выбранной VM.");
  }

  return { envFile, publicIpv4, verifyDns };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main(process.argv.slice(2));
}
