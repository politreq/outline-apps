// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package org.outline.vpn;

import java.util.Set;

/** Initial local catalog used to preselect apps that should bypass the VPN. */
final class RussianAppCatalog {
  private static final Set<String> EXACT_PACKAGES =
      Set.of(
          "com.avito.android",
          "com.idamob.tinkoff.android",
          "com.vkontakte.android",
          "com.wildberries.ru",
          "ru.auto.ara",
          "ru.dublgis.dgismobile",
          "ru.gosuslugi.android.apps.personaloffice",
          "ru.kinopoisk",
          "ru.ok.android",
          "ru.ozon.app.android",
          "ru.rutube.app",
          "ru.sberbankmobile",
          "ru.yandex.disk",
          "ru.yandex.mail",
          "ru.yandex.market",
          "ru.yandex.searchplugin",
          "ru.yandex.taximeter",
          "ru.yandex.yandexmaps",
          "ru.yandex.yandexnavi");

  // Company namespaces cover related apps without relying on localized display names.
  private static final String[] PACKAGE_PREFIXES = {
    "com.alfabank.",
    "com.avito.",
    "com.fixprice.",
    "com.gazprombank.",
    "com.kaspersky.",
    "com.mail.",
    "com.magnit.",
    "com.ozon.",
    "com.rutube.",
    "com.sber.",
    "com.tinkoff.",
    "com.vk.",
    "com.wildberries.",
    "com.yandex.",
    "ru.2gis.",
    "ru.alfabank.",
    "ru.avito.",
    "ru.beeline.",
    "ru.cian.",
    "ru.citilink.",
    "ru.deliveryclub.",
    "ru.dns.",
    "ru.dodopizza.",
    "ru.dublgis.",
    "ru.eldorado.",
    "ru.fixprice.",
    "ru.gazprombank.",
    "ru.gosuslugi.",
    "ru.kari.",
    "ru.kaspersky.",
    "ru.kinopoisk.",
    "ru.lamoda.",
    "ru.lenta.",
    "ru.lukoil.",
    "ru.mail.",
    "ru.magnit.",
    "ru.max.",
    "ru.megafon.",
    "ru.mos.",
    "ru.mts.",
    "ru.ozon.",
    "ru.pochtabank.",
    "ru.pyaterochka.",
    "ru.rosneft.",
    "ru.rshb.",
    "ru.rustore.",
    "ru.rutube.",
    "ru.samokat.",
    "ru.sber.",
    "ru.sberbank.",
    "ru.sovcombank.",
    "ru.sportmaster.",
    "ru.tatneft.",
    "ru.tele2.",
    "ru.tinkoff.",
    "ru.vk.",
    "ru.vkusvill.",
    "ru.vprok.",
    "ru.vtb.",
    "ru.wildberries.",
    "ru.yandex."
  };

  private RussianAppCatalog() {}

  static boolean contains(String packageName) {
    if (packageName == null || packageName.isEmpty()) {
      return false;
    }
    if (EXACT_PACKAGES.contains(packageName)) {
      return true;
    }
    for (String prefix : PACKAGE_PREFIXES) {
      if (packageName.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }
}
