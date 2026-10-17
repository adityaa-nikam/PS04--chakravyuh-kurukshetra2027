export async function GET() {
  return Response.json({ status: "ok", service: "cropping" });
}

export async function POST() {
  return Response.json({ status: "not_implemented" }, { status: 501 });
}
