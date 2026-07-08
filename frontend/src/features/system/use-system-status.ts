import { useQueries } from "@tanstack/react-query";

import { getSystemHealth, getSystemVersion } from "./system-api";

export function useSystemStatus() {
  const [health, version] = useQueries({
    queries: [
      {
        queryKey: ["system", "health"],
        queryFn: ({ signal }) => getSystemHealth(signal),
      },
      {
        queryKey: ["system", "version"],
        queryFn: ({ signal }) => getSystemVersion(signal),
      },
    ],
  });

  return {
    health,
    version,
    isPending: health.isPending || version.isPending,
    isError: health.isError || version.isError,
    refetch: async () => Promise.all([health.refetch(), version.refetch()]),
  };
}
