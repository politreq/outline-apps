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

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/** Persists independent selections for the two app routing modes. */
public final class AppRoutingPreferences {
  private static final String PREFERENCES_NAME = "app_routing";
  private static final String INITIALIZED_KEY = "defaults_initialized";
  private static final String BYPASSED_PACKAGES_KEY = "bypassed_packages";
  private static final String VPN_ONLY_KEY = "vpn_only";
  private static final String ALLOWED_PACKAGES_KEY = "allowed_packages";

  private AppRoutingPreferences() {}

  /** Initializes defaults from the complete installed package list. */
  @SuppressWarnings("deprecation")
  public static void initializeDefaultsIfNeeded(Context context) {
    PackageManager packageManager = context.getPackageManager();
    Collection<String> installedPackages = new ArrayList<>();
    for (ApplicationInfo info :
        packageManager.getInstalledApplications(PackageManager.GET_META_DATA)) {
      installedPackages.add(info.packageName);
    }
    initializeDefaultsIfNeeded(context, installedPackages);
  }

  /** Applies catalog defaults once. Apps installed later remain unselected. */
  public static synchronized void initializeDefaultsIfNeeded(
      Context context, Collection<String> installedPackages) {
    if (installedPackages == null || installedPackages.isEmpty()) {
      return;
    }
    SharedPreferences preferences = getPreferences(context);
    if (preferences.getBoolean(INITIALIZED_KEY, false)) {
      return;
    }

    Set<String> defaults = new HashSet<>();
    for (String packageName : installedPackages) {
      if (RussianAppCatalog.contains(packageName)) {
        defaults.add(packageName);
      }
    }
    preferences
        .edit()
        .putStringSet(BYPASSED_PACKAGES_KEY, defaults)
        .putBoolean(INITIALIZED_KEY, true)
        .commit();
  }

  public static Set<String> getBypassedPackages(Context context) {
    Set<String> stored = getPreferences(context).getStringSet(BYPASSED_PACKAGES_KEY, Set.of());
    return new HashSet<>(stored);
  }

  public static boolean isPackageBypassed(Context context, String packageName) {
    return getBypassedPackages(context).contains(packageName);
  }

  public static boolean isVpnOnly(Context context) {
    // Existing installations keep their bypass rules unchanged.
    return getPreferences(context).getBoolean(VPN_ONLY_KEY, false);
  }

  public static void setVpnOnly(Context context, boolean vpnOnly) {
    getPreferences(context).edit().putBoolean(VPN_ONLY_KEY, vpnOnly).commit();
  }

  public static Set<String> getSelectedPackages(Context context, boolean vpnOnly) {
    return new HashSet<>(getPreferences(context).getStringSet(
        vpnOnly ? ALLOWED_PACKAGES_KEY : BYPASSED_PACKAGES_KEY, Set.of()));
  }

  public static boolean hasInstalledVpnApps(Context context) {
    for (String packageName : getSelectedPackages(context, true)) {
      if (packageName.equals(context.getPackageName())) continue;
      try {
        context.getPackageManager().getApplicationInfo(packageName, 0);
        return true;
      } catch (PackageManager.NameNotFoundException ignored) {
        // A saved app may have been uninstalled since it was selected.
      }
    }
    return false;
  }

  public static synchronized void setPackageSelected(
      Context context, boolean vpnOnly, String packageName, boolean selected) {
    if (packageName == null || packageName.isEmpty() || packageName.equals(context.getPackageName())) {
      return;
    }
    Set<String> packages = getSelectedPackages(context, vpnOnly);
    if (selected) {
      packages.add(packageName);
    } else {
      packages.remove(packageName);
    }
    getPreferences(context).edit().putStringSet(
        vpnOnly ? ALLOWED_PACKAGES_KEY : BYPASSED_PACKAGES_KEY, packages).commit();
  }

  public static void setPackageBypassed(Context context, String packageName, boolean isBypassed) {
    if (packageName == null || packageName.isEmpty()) {
      return;
    }
    Set<String> packages = getBypassedPackages(context);
    if (isBypassed) {
      packages.add(packageName);
    } else {
      packages.remove(packageName);
    }
    getPreferences(context).edit().putStringSet(BYPASSED_PACKAGES_KEY, packages).commit();
  }

  private static SharedPreferences getPreferences(Context context) {
    return context
        .getApplicationContext()
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
  }
}
