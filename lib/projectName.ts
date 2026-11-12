// The name of a project. A new project starts as "Proyecto nuevo" with a
// temporary address ("proyecto-1a2b3c4d") until the owner says the real name,
// in the Brain or in the Store chat: then both change (while it is a draft).
import { slugify } from "./ai";
import { isSlugTaken, updateBusinessDetails, updateBusinessSlug } from "./db";
export { isPlaceholderName } from "./site";

export async function renameProject(b: { id: string; name: string; slug: string; published?: unknown }, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (!clean || clean === b.name) return;
  await updateBusinessDetails(b.id, { name: clean });
  // The temporary address changes to the real name while the page is a draft.
  if (!b.published && b.slug.startsWith("proyecto-")) {
    const base = slugify(clean) || "negocio";
    let slug = base;
    for (let n = 2; await isSlugTaken(slug); n++) slug = `${base}-${n}`;
    await updateBusinessSlug(b.id, slug);
  }
}
