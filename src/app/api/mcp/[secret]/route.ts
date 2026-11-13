import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isMcpSecret } from "@/lib/crypto";
import { createWrkoutMcpServer } from "@/lib/mcp/server";

// Remote MCP endpoint for the Claude app's custom connector. The unguessable path segment
// (MCP_SECRET) is the only credential, so anything else gets a plain 404. Stateless: each
// request gets a fresh server and transport.
export const maxDuration = 60;

async function handle(request: Request, ctx: RouteContext<"/api/mcp/[secret]">) {
  const { secret } = await ctx.params;
  if (!isMcpSecret(secret)) return new Response("Not found", { status: 404 });

  const server = createWrkoutMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const POST = handle;

// No server-initiated messages, so no standalone event stream to hold open (405 is the
// spec's answer for that), and no sessions to delete.
const notAllowed = () => new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
