import { notFound } from "next/navigation";
import { isDemoModeEnabled } from "@/lib/config/demo";
import GalleryClientPage from "./gallery-client";

export const dynamic = "force-dynamic";

export default function GalleryPage() {
  if (!isDemoModeEnabled()) {
    notFound();
  }
  return <GalleryClientPage />;
}
