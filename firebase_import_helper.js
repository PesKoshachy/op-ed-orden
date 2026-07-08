// Импорт стартовых данных OP/ED в Firebase Firestore.
// Версия БЕЗ оценок: импортируется только коллекция openings.
// Документы openings создаются с id = tempId, поэтому повторный импорт не создаёт дубли,
// а перезаписывает те же документы.

import {
  collection,
  doc,
  setDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

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

export async function importInitialOpenings(db, onProgress) {
  const openings = window.INITIAL_OPENINGS || [];

  if (!openings.length) {
    throw new Error("window.INITIAL_OPENINGS пустой. Проверь, что op_ed_initial_data.js подключён до импортера.");
  }

  const importBatchId = "excel_2018_2026_openings_only_v1";

  onProgress?.(`Готовлю опенинги: ${openings.length}`);
  const openingOps = openings.map(opening => {
    const openingId = String(opening.tempId || "").trim();
    if (!openingId) throw new Error("У опенинга нет tempId: " + JSON.stringify(opening).slice(0, 300));

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

  await setDoc(doc(db, "meta", "initial_import"), {
    importBatchId,
    openings: openingOps.length,
    ratings: 0,
    updatedAt: serverTimestamp()
  }, { merge: true });

  onProgress?.(`Готово. Опенинги: ${openingOps.length}. Оценки не импортировались.`);

  return {
    openings: openingOps.length,
    ratings: 0
  };
}
