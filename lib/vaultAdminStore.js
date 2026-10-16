import crypto from 'node:crypto';
import dbConnect from '@/lib/db';
import VaultOverride from '@/models/VaultOverride';
import { mergeVaultRows, validateVaultPatch, validateVaultIdentity, validateVaultEmbeds, buildVaultSeasons } from './vaultAdminCore.js';
import { recordAction } from '@/lib/adminAudit';
const error = (message,status) => Object.assign(new Error(message),{status});
export async function readVaultOverrides() {
  await dbConnect();
  return VaultOverride.find({}).lean();
}
export async function overlayVault(base, options = {}) {
  return mergeVaultRows(base,await readVaultOverrides(),options);
}
export async function mutateVault(base,action,body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('Invalid Vault request.',400);
  if (!['add','edit','hide','restore','reset','playback'].includes(action)) throw error('Unknown Vault action.',400);
  await dbConnect();
  if (action === 'add') {
    const kind = body.kind;
    if (!['movie','series'].includes(kind)) throw error('Choose movie or series.',400);
    const fields = validateVaultPatch(body.fields);
    const embeds = validateVaultEmbeds(body.embeds,kind);
    const custom = { ...fields,id:`admin-${crypto.randomUUID()}`, ...(kind==='series'?{kind:'series',seasons:buildVaultSeasons(embeds)}:{}),embeds,addedAt:new Date().toISOString(),categorySource:'admin' };
    validateVaultIdentity(custom);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';
    await VaultOverride.create({ id: custom.id, custom, patch: {}, revision: 1, note });
    await recordAction({
      area: 'vault', action: 'vault.add', targetModel: 'VaultOverride',
      summary: `Added “${custom.title || custom.id}” to the Vault`,
      target: { kind: 'vault-item', key: custom.id, label: custom.title || custom.id },
      before: null,
      after: { id: custom.id, custom, patch: {}, revision: 1, note },
    });
    return custom.id;
  }
  if (typeof body.id !== 'string' || body.id.length > 300) throw error('Invalid Vault ID.',400);
  if (!Number.isInteger(body.revision) || body.revision < 0) throw error('Reload the item before saving.',400);
  const doc = await VaultOverride.findOne({id:body.id}).lean();
  if ((doc?.revision || 0) !== body.revision) throw error('This item changed in another session. Reload before saving.',409);
  const original = doc?.custom || base.find(m=>m.id===body.id);
  if (!original) throw error('Vault item was not found upstream. No edit was saved.',404);
  let patch = {...doc?.patch},hidden = Boolean(doc?.hidden),note=doc?.note || '';
  if (action === 'edit') {
    patch={...patch,...validateVaultPatch(body.fields)};
    validateVaultIdentity({...original,...patch});
    if (typeof body.note !== 'string' || body.note.length > 2000) throw error('Use an owner note up to 2,000 characters.',400);
    note=body.note.trim();
    patch.categorySource='admin';
  }
  if (action === 'playback') {
    const embeds=validateVaultEmbeds(body.embeds,original.kind==='series'?'series':'movie');
    patch={...patch,embeds,...(original.kind==='series'?{seasons:buildVaultSeasons(embeds)}:{})};
  }
  if (action === 'hide') hidden=true;
  if (action === 'restore') hidden=false;
  if (action === 'reset') {
    if (doc?.custom) throw error('A custom item has no scraper metadata to reset to. Edit it or hide it.',400);
    patch={};note=''; // keep hidden status: reset must not silently republish a hidden item.
  }
  const next={patch,hidden,note,revision:body.revision+1};
  try {
    if (!doc) await VaultOverride.create({id:body.id,...next});
    else {
      const result=await VaultOverride.updateOne({id:body.id,revision:body.revision},{$set:next});
      if (result.modifiedCount !== 1) throw error('This item changed. Reload before saving.',409);
    }
  } catch (e) { if(e.code===11000) throw error('This item changed. Reload before saving.',409);throw e; }
  const snap = (value) => (value ? { id: value.id, custom: value.custom ?? null, patch: value.patch || {}, hidden: Boolean(value.hidden), note: value.note || '', revision: value.revision || 0 } : null);
  const VERBS = { edit: 'Edited', playback: 'Changed playback for', hide: 'Hid', restore: 'Restored', reset: 'Reset overrides on' };
  await recordAction({
    area: 'vault', action: `vault.${action}`, targetModel: 'VaultOverride',
    summary: `${VERBS[action] || action} “${patch.title || original.title || body.id}” in the Vault`,
    target: { kind: 'vault-item', key: body.id, label: patch.title || original.title || body.id },
    before: snap(doc),
    after: snap({ id: body.id, custom: doc?.custom, ...next }),
  });
  return body.id;
}
