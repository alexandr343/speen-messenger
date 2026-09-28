# Подключение Firebase

Страница уже использует Firebase Phone Authentication, Cloud Firestore и Cloud Storage. Пока настройки проекта не добавлены, приложение намеренно не имитирует отправку SMS и не сохраняет данные только в браузере.

## Подготовка проекта

1. Создайте проект в [Firebase Console](https://console.firebase.google.com/) и зарегистрируйте в нём Web-приложение.
2. В Authentication включите способ входа **Phone**, разрешите нужные страны в SMS region policy и добавьте HTTPS-домен сайта в Authorized domains. Для настоящих SMS не используйте `localhost` или `127.0.0.1`.
3. Создайте Cloud Firestore Database и Cloud Storage. Для SMS и Storage может потребоваться подключить тариф Blaze; проверьте актуальную стоимость, квоты и регион до включения. Добавьте бюджетные уведомления.
4. В `index.html` замените значения `PASTE_...` внутри `firebaseConfig` точной конфигурацией Web-приложения из Project settings. Скопируйте `storageBucket` именно таким, каким его показывает Firebase.
5. Опубликуйте приведённые ниже правила Firestore и Storage в соответствующих вкладках Rules.
6. Откройте приложение на HTTPS-домене, введите номер в международном формате (`+` и код страны), запросите SMS и подтвердите полученный код. Firebase reCAPTCHA и ограничения отправки SMS защищают форму от автоматических запросов. Для разработки Firebase позволяет настроить тестовые номера, которые не отправляют SMS; удалите их перед реальным использованием.

## Встроенный ИИ-бот

1. В Firebase Console откройте **AI Services → AI Logic → Get started** для проекта `speen-messenger-9b78c` и подключите Gemini Developer API.
2. В **App Check** зарегистрируйте Web-приложение с reCAPTCHA Enterprise и добавьте HTTPS-домен. Скопируйте site key (публичный ключ сайта, не секрет) в `appCheckSiteKey` в `index.html`. Не используйте debug-токен в production.
3. Страница загружает официальный Firebase AI Logic SDK. API-ключ Gemini в HTML не нужен. Учитывайте квоты и стоимость выбранного провайдера.
4. После включения AI Logic и App Check пользовательский диалог `Speen AI` сохраняется в Firestore. Если сервис не включён или ключ App Check не настроен, бот покажет подсказку вместо имитации ответа.

## Правила Cloud Firestore

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function chatMember(chatId) {
      return signedIn()
        && request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants;
    }

    match /users/{userId} {
      allow get: if signedIn();
      allow list: if false;
      allow create, update, delete: if signedIn() && request.auth.uid == userId;

      match /contacts/{contactId} {
        allow read, write: if signedIn() && request.auth.uid == userId;
      }
    }

    match /usernames/{username} {
      allow get: if signedIn();
      allow list: if false;
      allow create: if signedIn()
        && request.resource.data.uid == request.auth.uid
        && !exists(/databases/$(database)/documents/usernames/$(username));
      allow update: if signedIn()
        && resource.data.uid == request.auth.uid
        && request.resource.data.uid == request.auth.uid;
      allow delete: if signedIn() && resource.data.uid == request.auth.uid;
    }

    match /phoneLookup/{phoneNumber} {
      allow get: if signedIn();
      allow list: if false;
      allow create, update: if signedIn()
        && request.resource.data.uid == request.auth.uid
        && phoneNumber == request.auth.token.phone_number;
      allow delete: if signedIn() && resource.data.uid == request.auth.uid;
    }

    match /userDirectory/{userId} {
      allow get: if signedIn();
      allow list: if signedIn() && request.query.limit <= 10;
      allow create, update: if signedIn()
        && userId == request.auth.uid
        && request.resource.data.uid == request.auth.uid;
      allow delete: if signedIn() && userId == request.auth.uid;
    }

    match /chats/{chatId} {
      allow read: if signedIn() && request.auth.uid in resource.data.participants;
      allow create: if signedIn()
        && request.auth.uid in request.resource.data.participants
        && (
          (request.resource.data.kind == 'saved'
            && chatId == 'saved_' + request.auth.uid
            && request.resource.data.participants.size() == 1)
          || (request.resource.data.kind == 'bot'
            && chatId == 'bot_' + request.auth.uid
            && request.resource.data.participants.size() == 1)
          || (request.resource.data.kind == 'direct'
            && request.resource.data.participants.size() == 2)
        );
      allow update: if signedIn()
        && request.auth.uid in resource.data.participants
        && request.resource.data.participants == resource.data.participants;
      allow delete: if chatMember(chatId);

      match /messages/{messageId} {
        allow read: if chatMember(chatId);
        allow create: if chatMember(chatId)
          && request.resource.data.createdAt == request.time
          && (request.resource.data.senderId == request.auth.uid
            || (get(/databases/$(database)/documents/chats/$(chatId)).data.kind == 'bot'
              && request.resource.data.senderId == 'speen_ai_bot'));
        allow update: if chatMember(chatId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions'])
          && (
            (!request.resource.data.keys().hasAny(['reactions'])
              && resource.data.reactions.keys().hasOnly([request.auth.uid]))
            || (request.resource.data.keys().hasAny(['reactions'])
              && (!resource.data.keys().hasAny(['reactions'])
                ? request.resource.data.reactions.keys().hasOnly([request.auth.uid])
                : request.resource.data.reactions.diff(resource.data.reactions).affectedKeys().hasOnly([request.auth.uid])))
          )
          && (!request.resource.data.keys().hasAny(['reactions'])
            || !request.resource.data.reactions.keys().hasAny([request.auth.uid])
            || request.resource.data.reactions[request.auth.uid] in ['❤️','😂','👍','🔥','✨','🎉']);
        allow delete: if chatMember(chatId);
      }
    }
  }
}
```

Правило удаления сообщений разрешает очистить историю только участнику соответствующего чата. Очистка удаляет общие документы сообщений, поэтому история исчезнет у всех участников диалога.

История хранится в `chats/{chatId}/messages/{messageId}`; у каждого сообщения есть `senderId` и `createdAt: serverTimestamp()`. Ответы содержат снимок цитаты `replyTo` с ID исходного сообщения, автором и текстом. Отправка сообщения, превью и увеличение `unreadCounts.{uid}` получателя выполняются одной Firestore batch-операцией; при чтении чат записывает `lastReadAt.{uid}` и сбрасывает этот счётчик. `onSnapshot` доставляет изменения открытым участникам, а keyed-рендерер обновляет только добавленные или изменённые сообщения. Для индикатора печати приложение обновляет `chats/{chatId}.typing.{uid}` серверным timestamp; поле удаляется после паузы, а клиенты игнорируют отметки старше 5 секунд. `users/{uid}.lastActiveAt` обновляется при входе, переключении видимости/закрытии вкладки и раз в минуту, пока приложение активно; профили собеседников слушаются через `onSnapshot`. Правило Firestore требует серверную метку времени у каждого нового сообщения.

Индекс `phoneLookup` создаётся приложением для номера, подтверждённого Firebase Authentication. Нормализованный номер используется как ID документа, тело содержит только UID; массовое чтение индекса запрещено. `userDirectory` содержит имя, username и аватар; номер добавляется в публичную карточку только по явному разрешению владельца и удаляется при включении настройки скрытия. Каталог доступен вошедшим пользователям, а запросы ограничены 10 результатами. Настройки приватности, оформления и уведомлений (`notificationSettings`: входящий/исходящий звук, звук печати, интерфейсные сигналы, системные уведомления) сохраняются в `users/{uid}`; desktop-уведомления требуют разрешения браузера.

## Правила Cloud Storage

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function signedIn() {
      return request.auth != null;
    }

    function chatMember(chatId) {
      return signedIn()
        && request.auth.uid in firestore.get(
          /databases/(default)/documents/chats/$(chatId)
        ).data.participants;
    }

    match /avatars/{userId}/{fileName} {
      allow read: if signedIn();
      allow create, update: if signedIn()
        && request.auth.uid == userId
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
      allow delete: if signedIn() && request.auth.uid == userId;
    }

    match /uploads/{chatId}/{userId}/{fileName} {
      allow read: if chatMember(chatId);
      allow create, update: if chatMember(chatId)
        && request.auth.uid == userId
        && request.resource.size < 100 * 1024 * 1024;
      allow delete: if false;
    }
  }
}
```

## Важно

Профили, настройки, контакты, история сообщений и состояние чатов хранятся в Cloud Firestore; аватары и вложения чатов хранятся в Cloud Storage. Открытые чаты и профили собеседников обновляются в реальном времени. Это не заменяет резервное копирование: настройте экспорт Firestore и проверяйте квоты и биллинг проекта. Ссылки Firebase Storage, полученные приложением, являются ссылками-доступами; не пересылайте их за пределы чата. Перед публикацией проверьте правила в Firebase Rules Playground и используйте только HTTPS-домен.
