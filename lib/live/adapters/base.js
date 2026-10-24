/**
 * lib/live/adapters/base.js — v12 Base adapter
 */

export class BaseAdapter {
  constructor(sourceDef) {
    this.def = sourceDef;
  }
  async fetchText(fetchFn) {
    const { url, timeoutMs, retry, headers } = this.def;
    return fetchFn(url, { timeoutMs, retry, headers });
  }
  // Override in subclasses
  async parse(text, sourceDef) { throw new Error('parse() not implemented'); }
  async fetchAndParse(fetchFn) {
    const text = await this.fetchText(fetchFn);
    return this.parse(text, this.def);
  }
}
