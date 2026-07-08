# OP/ED Orden — Firebase-ready версия

Этот комплект переводит сайт с локального хранения на общую базу Firebase Firestore.

## Что загрузить в корень репозитория

- `index.html`
- `oped-app.js`
- `firebase-config.js`
- `firestore.rules`
- `firebase-import.html`
- `firebase_import_helper.js`
- `op_ed_initial_data.js`
- `op_ed_initial_data.json`

## Перед загрузкой

В `firebase-config.js` заменить заглушки `ВСТАВЬ_...` на config из Firebase Console.

## В Firebase нужно

1. Создать проект.
2. Создать Web App и взять `firebaseConfig`.
3. Включить Authentication → Sign-in method → Anonymous.
4. Создать Firestore Database.
5. Вставить и опубликовать правила из `firestore.rules`.

## После загрузки в GitHub

1. Открыть сайт.
2. Открыть `/firebase-import.html`.
3. Нажать «Начать импорт».
4. Дождаться завершения.
5. После успешного импорта удалить `firebase-import.html` из публичного репозитория.

Подробная инструкция лежит в `README_ЗАГРУЗКА_В_GITHUB_ПО_ШАГАМ.txt`.
