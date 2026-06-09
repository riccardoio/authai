import { redirect } from "next/navigation";

/**
 * /docs alone has no canonical page — redirect to the introduction.
 * The demo-react demo had the same default landing inside the docs
 * shell, so visitors hitting /docs anywhere expect to land on the
 * introduction.
 */
export default function DocsIndex() {
  redirect("/docs/introduction");
}
