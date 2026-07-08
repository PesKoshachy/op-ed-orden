// Импорт стартовых данных OP/ED в Firebase Firestore.
// Используется страницей firebase-import.html.
// Документы openings создаются с id = tempId, поэтому повторный импорт не создаёт дубли,
// а перезаписывает те же документы.

import {
  collection,
  doc,
  setDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

function normalizeNickname(nickname) {
  return String(nickname || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9_-]+/gi, "_")
    .slice(0, 60);
}

function asList(value) {
  if (Array.isArray(value)) return value.map(String).map(x => x.trim()).filter(Boolean);
  return String(value || "").split(",").map(x => x.trim()).filter(Boolean);
}

async function commitChunks(db, operations, onProgress, label) {
  const chunkSize = 450;
  let done = 0;

  for (let i = 0; i < operations.length; i += chunkSize) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + chunkSize);

    for (const op of chunk) {
      batch.set(op.ref, op.data, { merge: true });
    }

    await batch.commit();
    done += chunk.length;
    onProgress?.(`${label}: ${done}/${operations.length}`);
  }
}

export async function importInitialOpeningsAndRatings(db, onProgress) {
  const openings = window.INITIAL_OPENINGS || [];
  const ratings = window.INITIAL_RATINGS || [];

  if (!openings.length) {
    throw new Error("window.INITIAL_OPENINGS пустой. Проверь, что op_ed_initial_data.js подключён до импортера.");
  }

  const importBatchId = "excel_2018_2026_v1";
  const openingIds = new Set();

  onProgress?.(`Готовлю опенинги: ${openings.length}`);
  const openingOps = openings.map(opening => {
    const openingId = String(opening.tempId || "").trim();
    if (!openingId) throw new Error("У опенинга нет tempId: " + JSON.stringify(opening).slice(0, 300));
    openingIds.add(openingId);

    return {
      ref: doc(collection(db, "openings"), openingId),
      data: {
        title: String(opening.title || opening.anime || "").trim(),
        anime: String(opening.anime || opening.title || "").trim(),
        type: opening.type === "ED" ? "ED" : "OP",
        year: Number(opening.year || 0),
        season: String(opening.season || "").trim(),
        order: Number(opening.order || 0),
        studios: asList(opening.studios),
        directors: asList(opening.directors),
        performers: asList(opening.performers),
        image: String(opening.image || "").trim(),
        link: String(opening.link || "").trim(),
        createdBy: "import",
        importTempId: openingId,
        importBatchId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    };
  });

  await commitChunks(db, openingOps, onProgress, "Импорт опенингов");

  onProgress?.(`Готовлю оценки: ${ratings.length}`);
  const ratingOps = [];

  for (const rating of ratings) {
    const openingId = String(rating.openingTempId || "").trim();
    if (!openingIds.has(openingId)) continue;

    const safeNickname = normalizeNickname(rating.nickname);
    const score = Number(rating.score);

    if (!safeNickname || Number.isNaN(score)) continue;

    ratingOps.push({
      ref: doc(collection(db, "ratings"), `${safeNickname}__${openingId}`),
      data: {
        openingId,
        nickname: String(rating.nickname || "").trim(),
        score,
        updatedAt: serverTimestamp()
      }
    });
  }

  await commitChunks(db, ratingOps, onProgress, "Импорт оценок");

  await setDoc(doc(db, "meta", "initial_import"), {
    importBatchId,
    openings: openingOps.length,
    ratings: ratingOps.length,
    updatedAt: serverTimestamp()
  }, { merge: true });

  onProgress?.(`Готово. Опенинги: ${openingOps.length}. Оценки: ${ratingOps.length}.`);

  return {
    openings: openingOps.length,
    ratings: ratingOps.length
  };
}
