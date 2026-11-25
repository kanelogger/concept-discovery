import { randomBytes } from 'node:crypto';

export const validShareToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
export const validPreviewId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);

export function cardShareStore(database) {
  database.exec('PRAGMA secure_delete = ON');
  // Additive so an existing owner database and sessions survive the upgrade.
  database.exec(`
    CREATE TABLE IF NOT EXISTS card_shares (
      card_id TEXT PRIMARY KEY,
      token TEXT UNIQUE,
      content TEXT,
      generation INTEGER NOT NULL,
      CHECK ((token IS NULL) = (content IS NULL))
    ) STRICT
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS card_share_previews (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      cover_type TEXT,
      cover BLOB,
      version INTEGER NOT NULL DEFAULT 1
    ) STRICT;
    CREATE TABLE IF NOT EXISTS card_share_deletions (card_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE IF NOT EXISTS card_share_pending_deletions (card_id TEXT PRIMARY KEY) STRICT;
    CREATE TRIGGER IF NOT EXISTS clear_revoked_card_preview
    AFTER UPDATE OF token ON card_shares
    WHEN OLD.token IS NOT NULL AND OLD.token IS NOT NEW.token
    BEGIN
      DELETE FROM card_share_previews WHERE token = OLD.token;
    END;
  `);
  const visible = alias => `NOT EXISTS (SELECT 1 FROM card_share_pending_deletions d WHERE d.card_id = ${alias}.card_id)`;
  const byCard = database.prepare(`SELECT CASE WHEN ${visible('s')} THEN token END AS token,generation FROM card_shares s WHERE card_id = ?`);
  const byToken = database.prepare(`SELECT card_id AS cardId FROM card_shares s WHERE token = ? AND ${visible('s')}`);
  const contentFor = database.prepare(`SELECT content FROM card_shares s WHERE token = ? AND ${visible('s')}`);
  const insert = database.prepare(`
    INSERT INTO card_shares (card_id, token, content, generation)
    SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM card_share_deletions WHERE card_id = ?)
      AND NOT EXISTS (SELECT 1 FROM card_share_pending_deletions WHERE card_id = ?)
    ON CONFLICT(card_id) DO UPDATE SET
      token = coalesce(card_shares.token, excluded.token),
      content = coalesce(card_shares.content, excluded.content)
    WHERE card_shares.generation = excluded.generation
    RETURNING token
  `);
  const remove = database.prepare(`
    UPDATE card_shares AS s SET token = NULL, content = NULL, generation = generation + 1
    WHERE card_id = ? AND token = ? AND ${visible('s')}
  `);
  const deletion = database.prepare('INSERT INTO card_share_deletions VALUES (?) ON CONFLICT DO NOTHING');
  const wasDeleted = database.prepare('SELECT 1 FROM card_share_deletions WHERE card_id = ?');
  const pending = database.prepare('INSERT INTO card_share_pending_deletions VALUES (?) ON CONFLICT DO NOTHING');
  const pendingFor = database.prepare('SELECT 1 FROM card_share_pending_deletions WHERE card_id = ?');
  const removePending = database.prepare('DELETE FROM card_share_pending_deletions WHERE card_id = ?');
  const advance = database.prepare(`
    INSERT INTO card_shares (card_id, token, content, generation) VALUES (?, NULL, NULL, 1)
    ON CONFLICT(card_id) DO UPDATE SET generation = card_shares.generation + 1 WHERE ? = 1
  `);
  const redact = database.prepare('UPDATE card_shares SET token = NULL, content = NULL, generation = generation + 1 WHERE card_id = ?');
  const replayRevocation = database.prepare(`
    INSERT INTO card_shares (card_id,token,content,generation) VALUES (?,NULL,NULL,?)
    ON CONFLICT(card_id) DO UPDATE SET token=NULL,content=NULL,
      generation=MAX(excluded.generation,card_shares.generation+(card_shares.token IS NOT NULL))
    WHERE card_shares.token IS NOT NULL OR card_shares.generation<excluded.generation
  `);
  const previewColumns = 'p.id, p.title, p.description, p.cover_type AS coverType, p.version';
  const previewLink = 'FROM card_share_previews p JOIN card_shares s ON s.token = p.token';
  const previewByToken = database.prepare(`SELECT ${previewColumns} ${previewLink} WHERE p.token = ? AND ${visible('s')}`);
  const previewById = database.prepare(`SELECT ${previewColumns}, s.card_id AS cardId ${previewLink} WHERE p.id = ? AND ${visible('s')}`);
  const coverById = database.prepare(`SELECT p.cover_type AS type, p.cover ${previewLink} WHERE p.id = ? AND ${visible('s')}`);
  const addPreview = database.prepare(`
    INSERT INTO card_share_previews (id, token, title, description, cover_type, cover)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO NOTHING
  `);
  const editPreview = database.prepare(`
    UPDATE card_share_previews SET title = ?, description = ?, cover_type = ?, cover = ?, version = version + 1
    WHERE token = ?
  `);
  function transaction(action) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }
  }
  function add(token, { title, description, cover }) {
    addPreview.run(randomBytes(16).toString('hex'), token, title, description, cover?.type ?? null, cover?.bytes ?? null);
  }
  function publish(cardId,generation,content) {
    return insert.get(cardId,randomBytes(32).toString('base64url'),JSON.stringify(content),generation,cardId,cardId)?.token;
  }
  return {
    state: cardId => byCard.get(cardId) ?? { token: null, generation: 0 },
    create:publish,
    createWithPreview(cardId, generation, content, preview) {
      return transaction(() => {
        const token = publish(cardId,generation,content);
        if (token) add(token, preview);
        return token;
      });
    },
    savePreview(cardId, token, version, { title, description, cover }) {
      return transaction(() => {
        if (!validShareToken(token) || byCard.get(cardId)?.token !== token) return false;
        if ((previewByToken.get(token)?.version ?? 0) !== version) return false;
        if (!editPreview.run(title, description, cover?.type ?? null, cover?.bytes ?? null, token).changes) {
          add(token, { title, description, cover });
        }
        return true;
      });
    },
    previewFor: token => previewByToken.get(token),
    previewById: id => previewById.get(id),
    coverById: id => coverById.get(id),
    cardFor: token => validShareToken(token) ? byToken.get(token)?.cardId : null,
    contentFor: token => contentFor.get(token)?.content,
    revoke: (cardId, token) => remove.run(cardId, token).changes > 0,
    revokeAll: () => database.exec('UPDATE card_shares SET token = NULL, content = NULL, generation = generation + 1'),
    suspendForDeletion(cardId) {
      return transaction(()=>{
        if (!wasDeleted.get(cardId)) {
          const newlyPending = pending.run(cardId).changes;
          advance.run(cardId, newlyPending);
        }
        return Boolean(pendingFor.get(cardId) || wasDeleted.get(cardId));
      });
    },
    fencedForDeletion:cardId=>Boolean(pendingFor.get(cardId) || wasDeleted.get(cardId)),
    releasePendingDeletion(cardId,minimumGeneration) {
      return transaction(()=>{
        if (wasDeleted.get(cardId) || (minimumGeneration!==undefined &&
            (!Number.isSafeInteger(minimumGeneration) || minimumGeneration<1))) return false;
        if (pendingFor.get(cardId)) {
          advance.run(cardId,0);
          redact.run(cardId);
          removePending.run(cardId);
        }
        if (minimumGeneration!==undefined) replayRevocation.run(cardId,minimumGeneration);
        return true;
      });
    },
    purge(cardId) {
      transaction(() => {
        if (deletion.run(cardId).changes) redact.run(cardId);
        removePending.run(cardId);
      });
      // Pre-upgrade revocations may have left content in free pages. Rebuild
      // before declaring the online database and its WAL clean.
      database.exec('VACUUM');
      const checkpoint = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      return { checkpointed:checkpoint?.busy === 0, unpublished:!byCard.get(cardId)?.token };
    },
    purged: cardId => Boolean(wasDeleted.get(cardId)) && !byCard.get(cardId)?.token,
  };
}
