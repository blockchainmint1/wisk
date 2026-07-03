import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/exchange")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(null, {
          status: 301,
          headers: { location: "/" },
        });
      },
    },
  },
});
