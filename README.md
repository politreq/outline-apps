# <img alt="Outline Manager Logo" src="docs/resources/logo_manager.png" title="Outline Manager" width="32">&nbsp;&nbsp;Outline Apps&nbsp;&nbsp;<img alt="Outline Client Logo" src="docs/resources/logo_client.png" title="Outline Client" width="32">

[![Reddit](https://badgen.net/badge/Reddit/r%2Foutlinevpn/orange)](https://www.reddit.com/r/outlinevpn/) [![Mattermost](https://badgen.net/badge/Mattermost/Outline%20Community/blue)](https://community.internetfreedomfestival.org/community/channels/outline-community) [![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)

Outline makes it easy for anyone to create a VPN server, allowing you to share access to the free and open internet with those in need. **We have two core applications:**

&nbsp;&nbsp;&nbsp;&nbsp;<img alt="Outline Manager Logo" src="docs/resources/logo_manager.png" title="Outline Manager" width="14">&nbsp;&nbsp;**Outline Manager** ([`/server_manager`](server_manager)): A graphical user interface for managing Outline servers. It is available for Windows, macOS, and Linux. [You can install the manager here](https://getoutline.org/get-started/#step-1). See [`server_manager/README.md`](./server_manager/README.md) for more information.


&nbsp;&nbsp;&nbsp;&nbsp;<img alt="Outline Client Logo" src="docs/resources/logo_client.png" title="Outline Client" width="14">&nbsp;&nbsp;**Outline Client** ([`/client`](client)): A cross-platform proxy client for Windows, macOS, iOS, Android, and Linux. The Outline Client is designed for use with the server deployed with the Outline Manager, but it is also fully compatible with any [Shadowsocks](https://shadowsocks.org/) server. [You can install the client here](https://getoutline.org/get-started/#step-3). See [`client/README.md`](./client/README.md) for more information.


## Community and Support

Interested in **contributing to Outline?** See our [Contributing Guide](CONTRIBUTING.md) for more information.

See [AGENTS.md](./AGENTS.md) for AI agent and developer guidance.

## «В домике»: навигация и профили

Меню Android-клиента: **Домой → Профили → VPN для приложений → О приложении**.
На главной остаются домик, кнопка на двери и состояние VPN. Название выбранного
профиля и список ключей находятся в «Профилях»; новый ключ можно добавить кнопкой
«+». Выбранный профиль сохраняется на устройстве после перезапуска приложения.
Если VPN уже работает, выбор другого профиля не прерывает соединение сам:
сначала отключите VPN кнопкой на двери, затем включите его с новым профилем.

«VPN для приложений» использует ту же светлую палитру, что и главная, независимо
от системной темы. Отмеченные приложения подключаются напрямую. После изменения
галочки появляется напоминание переподключиться к профилю, чтобы Android применил
новые правила; сами правила сохраняются сразу.

## «В домике»: самостоятельные обновления Android

Android-клиент автоматически проверяет стабильный HTTPS manifest:

```text
https://82.38.68.250.sslip.io/v-domike/latest.json
```

Новая версия предлагается только когда опубликованный `versionCode` больше
установленного. Перед запуском системного установщика клиент проверяет HTTPS,
размер, SHA-256, package id, `versionCode` и совпадение сертификата подписи.
Android всё равно просит пользователя явно подтвердить установку и при первом
обновлении может попросить разрешить установку из «В домике».

В 1.1.6 исправлен конфликт FileProvider с Cordova, из-за которого установщик
закрывался сразу после скачивания APK. Для перехода с 1.1.5 или более старой
версии скачайте APK браузером и установите поверх приложения, не удаляя его:
профили и настройки сохранятся. После этого используйте встроенное обновление.
Провайдер обновлений имеет отдельный класс и открывает только `cache/updates`;
перед передачей APK проверяется чтение именно через `content://` URI.

Регрессионная Android-проверка находится в
`client/src/cordova/plugin/android/test/java/org/outline/AppUpdateInstallerTest.java`.
После штатной подготовки Android-проекта соберите `:app:assembleDebugAndroidTest`
с тем же `--include-build=../../src/cordova/android/OutlineAndroidLib`, что и приложение.
Тестовый APK подпишите сертификатом установленного release APK и установите
на отдельный эмулятор. Runner не зависит от переименованных R8-классов приложения:

```bash
adb shell am instrument -w -r \
  com.vdomike.vpn.test/org.outline.AppUpdateInstallerTest
```

Без параметров проверяются разные provider-компоненты, чтение update URI и
запрет выхода за каталог обновлений. Для проверки кнопки добавьте перед именем
runner `-e updateApkPath /data/local/tmp/newer-qa.apk`: это заранее загруженный
тестовый APK с большим versionCode и той же подписью. На эмуляторе предварительно
пройдите первый запуск и разрешите установку из приложения. Проверка подставляет
только состояние уже скачанного файла, нажимает видимую кнопку и ждёт настоящего
системного подтверждения. Само обновление подтверждается отдельно после выхода
runner; затем нужно проверить новую установленную версию. QA APK не публикуется.

Публикация выполняется с последним реально распространённым APK как baseline:

```bash
scripts/publish-app-update.sh \
  /path/to/new.apk \
  "Краткое описание изменений" \
  /path/to/previously-published.apk
```

Скрипт сначала публикует versioned APK, проверяет package, версию и непрерывность
подписи, а затем атомарно переключает `latest.json`.

You can also **join the Outline Community** by signing up for the [IFF Mattermost](https://wiki.digitalrights.community/index.php?title=IFF_Mattermost)!

For customer support and to **contact us directly**, go to https://support.getoutline.org.
