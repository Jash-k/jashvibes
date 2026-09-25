import dbConnect from '@/lib/db';
import VodSource from '@/models/VodSource';
import { getVodSources } from '@/lib/vodM3u';

/**
 * Mongo-first VOD source list for ReTro syncs.
 *
 * First run: the collection is seeded from the hardcoded/env-derived list, so
 * a deploy behaves exactly like before. From then on the admin panel's CRUD
 * is authoritative — deleting a source there wins even if the env still lists it.
 */
export async function seedVodSourcesIfEmpty() {
  await dbConnect();
  const count = await VodSource.estimatedDocumentCount();
  if (count > 0) return false;
  const seeds = getVodSources();
  if (!seeds.length) return false;
  await VodSource.insertMany(
    seeds.map((seed, index) => ({ name: seed.label, url: seed.url, sortOrder: (index + 1) * 10 })),
  ).catch(() => {});
  return true;
}

export async function getActiveVodSources() {
  await seedVodSourcesIfEmpty();
  const docs = await VodSource.find({ enabled: true }).sort({ sortOrder: 1, name: 1 }).lean().catch(() => []);
  if (docs.length) {
    return docs.map((doc) => ({ id: String(doc._id), label: doc.name, url: doc.url }));
  }
  return getVodSources();
}
