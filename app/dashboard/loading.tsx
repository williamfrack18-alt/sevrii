import SevriiLoader from "@/components/SevriiLoader";

// While the dashboard loads (after picking a path on /start, after signing
// in, or after switching projects): Sevrii's logo filling with green light.
export default function Loading() {
  return <SevriiLoader full />;
}
