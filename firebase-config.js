// 1) Зайди в Firebase Console -> Project settings -> General -> Your apps -> Web app.
// 2) Скопируй firebaseConfig.
// 3) Замени значения ниже на свои.
//
// Это НЕ пароль. Но правила Firestore всё равно надо настроить через firestore.rules.

window.FIREBASE_CONFIG = {
  apiKey: "ВСТАВЬ_API_KEY",
  authDomain: "ВСТАВЬ_PROJECT_ID.firebaseapp.com",
  projectId: "ВСТАВЬ_PROJECT_ID",
  storageBucket: "ВСТАВЬ_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "ВСТАВЬ_MESSAGING_SENDER_ID",
  appId: "ВСТАВЬ_APP_ID"
};
