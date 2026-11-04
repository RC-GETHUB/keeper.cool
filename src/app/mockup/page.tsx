import type { Metadata } from "next";
import { Mockup } from "./mockup";

export const metadata: Metadata = {
  title: "Keeper – new design (mockup)",
  robots: { index: false, follow: false },
};

export default function MockupPage() {
  return <Mockup />;
}
