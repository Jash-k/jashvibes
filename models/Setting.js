import mongoose from 'mongoose';

/** Tiny key/value store for server-side settings (admin session epoch, …). */
const SettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export default mongoose.models.Setting || mongoose.model('Setting', SettingSchema);

/** Read one setting value (or the fallback). */
export async function getSetting(key, fallback = null) {
  const doc = await (mongoose.models.Setting || mongoose.model('Setting', SettingSchema))
    .findOne({ key }).lean().catch(() => null);
  return doc?.value ?? fallback;
}

/** Write one setting value. */
export async function setSetting(key, value) {
  const Setting = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
}
