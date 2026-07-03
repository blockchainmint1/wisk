import { createFileRoute } from "@tanstack/react-router";

const redirectHome = () =>
  new Response(null, {
    status: 301,
    headers: { location: "/" },
  });

export const Route = createFileRoute("/exchange")({
  server: {
    handlers: {
      GET: redirectHome,
      HEAD: redirectHome,
    },
  },
});

