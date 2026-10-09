import crypto from 'node:crypto';
import dbConnect from '@/lib/db';
import Setting from '@/models/Setting';
import { getConfiguredEmbedSites } from '@/lib/embedSites';
import { EXTRAS_KEY, changeExtras, legacyExtras } from '@/lib/extrasRegistry';

export async function readExtras(appOrigin = '') {
  await dbConnect();
  const doc = await Setting.findOne({ key: EXTRAS_KEY }).lean();
  if (doc) {
    if (!Array.isArray(doc.value?.sites) || !Number.isInteger(doc.value?.version)) throw new Error('Invalid website registry.');
    return { registry: doc.value, exists: true, source: 'database' };
  }
  // Read-only fallback. Saving the first admin action imports the current env list.
  return { registry: { version: 0, sites: legacyExtras(getConfiguredEmbedSites(), appOrigin) }, exists: false, source: 'environment' };
}

export async function writeExtras(command, body, appOrigin = '') {
  const { registry, exists } = await readExtras(appOrigin);
  const next = changeExtras(registry, command, body, crypto.randomUUID(), appOrigin);
  try {
    if (!exists) await Setting.create({ key: EXTRAS_KEY, value: next });
    else {
      const result = await Setting.updateOne({ key: EXTRAS_KEY, 'value.version': registry.version }, { $set: { value: next } });
      if (result.modifiedCount !== 1) throw Object.assign(new Error('The website list changed. Reload before saving.'), { status: 409 });
    }
  } catch (error) {
    if (error.code === 11000) throw Object.assign(new Error('The website list changed. Reload before saving.'), { status: 409 });
    throw error;
  }
  return next;
}
