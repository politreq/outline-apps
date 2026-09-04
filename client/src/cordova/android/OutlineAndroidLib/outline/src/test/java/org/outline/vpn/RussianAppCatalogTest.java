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

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RussianAppCatalogTest {
  @Test
  public void matchesExactPackages() {
    assertTrue(RussianAppCatalog.contains("com.vkontakte.android"));
    assertTrue(RussianAppCatalog.contains("ru.sberbankmobile"));
  }

  @Test
  public void matchesCompanyNamespaces() {
    assertTrue(RussianAppCatalog.contains("ru.yandex.example"));
    assertTrue(RussianAppCatalog.contains("com.ozon.example"));
  }

  @Test
  public void doesNotMatchForeignOrLookalikePackages() {
    assertFalse(RussianAppCatalog.contains("com.google.android.youtube"));
    assertFalse(RussianAppCatalog.contains("example.ru.yandex.app"));
    assertFalse(RussianAppCatalog.contains(null));
  }
}
