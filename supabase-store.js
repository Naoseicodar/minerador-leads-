/**
 * SupabaseStore — RemoteAuth store para whatsapp-web.js
 * Salva a sessao como ZIP no Supabase Storage (bucket: whatsapp-sessions)
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const BUCKET = "whatsapp-sessions";

class SupabaseStore {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }

  async _garantirBucket() {
    const { data: buckets } = await this.supabase.storage.listBuckets();
    const existe = buckets && buckets.some(b => b.name === BUCKET);
    if (!existe) {
      await this.supabase.storage.createBucket(BUCKET, { public: false });
    }
  }

  async sessionExists({ session }) {
    await this._garantirBucket();
    const { data } = await this.supabase.storage
      .from(BUCKET)
      .list("", { search: `${session}.zip` });
    return !!(data && data.some(f => f.name === `${session}.zip`));
  }

  async save({ session, path }) {
    await this._garantirBucket();
    const buffer = fs.readFileSync(path);
    await this.supabase.storage
      .from(BUCKET)
      .upload(`${session}.zip`, buffer, {
        contentType: "application/zip",
        upsert: true,
      });
  }

  async extract({ session, path }) {
    await this._garantirBucket();
    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .download(`${session}.zip`);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(path, buffer);
  }

  async delete({ session }) {
    await this.supabase.storage
      .from(BUCKET)
      .remove([`${session}.zip`]);
  }
}

module.exports = { SupabaseStore };
