const SAFE_COMMAND_ARGUMENT = /^[A-Za-z0-9:.-]+$/;

export function buildWindowsPnpmInvocation(args, commandShell = "cmd.exe") {
  if (!args.every((argument) => SAFE_COMMAND_ARGUMENT.test(argument))) {
    throw new Error("Windows pnpm command содержит недопустимый аргумент.");
  }

  return {
    args: ["/d", "/s", "/c", ["pnpm.cmd", ...args].join(" ")],
    command: commandShell,
  };
}
