import { createFileRoute } from "@tanstack/react-router";
import BedRadar from "@/components/BedRadar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BedRadar — Find General-Ward Hospital Beds Near You" },
      { name: "description", content: "Compare nearby hospitals by bed availability, distance, admission fee and rating on an interactive map." },
      { property: "og:title", content: "BedRadar — Smart Hospital Finder" },
      { property: "og:description", content: "Find, rank and navigate to hospitals with general-ward beds available." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BedRadar,
});
