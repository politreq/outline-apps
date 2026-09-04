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

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.text.Collator;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.outline.R;

/** Android-only screen for selecting applications that should bypass the VPN. */
public class AppRoutingActivity extends Activity {
  private static final int ACCENT_COLOR = Color.rgb(47, 190, 165);

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final List<ApplicationItem> allApps = new ArrayList<>();
  private final Set<String> bypassedPackages = new HashSet<>();

  private AppListAdapter adapter;
  private TextView selectedCount;
  private ListView appList;
  private ProgressBar progressBar;
  private int backgroundColor;
  private int cardColor;
  private int primaryTextColor;
  private int secondaryTextColor;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    configureColors();
    setContentView(buildContentView());
    loadApplications();
  }

  @Override
  protected void onDestroy() {
    executor.shutdownNow();
    super.onDestroy();
  }

  private View buildContentView() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(backgroundColor);

    LinearLayout header = new LinearLayout(this);
    header.setGravity(Gravity.CENTER_VERTICAL);
    header.setPadding(dp(8), dp(12), dp(16), dp(8));

    TextView back = new TextView(this);
    back.setText("‹");
    back.setTextSize(42);
    back.setGravity(Gravity.CENTER);
    back.setTextColor(primaryTextColor);
    back.setContentDescription(getString(R.string.app_routing_back));
    back.setOnClickListener(view -> finish());
    header.addView(back, new LinearLayout.LayoutParams(dp(56), dp(56)));

    TextView title = new TextView(this);
    title.setText(R.string.app_routing_title);
    title.setTextSize(22);
    title.setTextColor(primaryTextColor);
    title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
    header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    root.addView(header);

    TextView description = new TextView(this);
    description.setText(R.string.app_routing_description);
    description.setTextSize(15);
    description.setTextColor(secondaryTextColor);
    description.setPadding(dp(24), 0, dp(24), dp(12));
    root.addView(description);

    selectedCount = new TextView(this);
    selectedCount.setTextSize(14);
    selectedCount.setTextColor(secondaryTextColor);
    selectedCount.setAllCaps(true);
    selectedCount.setPadding(dp(24), dp(4), dp(24), dp(8));
    updateSelectedCount();
    root.addView(selectedCount);

    EditText search = new EditText(this);
    search.setSingleLine(true);
    search.setHint(R.string.app_routing_search_hint);
    search.setTextColor(primaryTextColor);
    search.setHintTextColor(secondaryTextColor);
    search.setTextSize(17);
    search.setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_search, 0, 0, 0);
    search.setCompoundDrawablePadding(dp(12));
    search.setBackgroundTintList(ColorStateList.valueOf(secondaryTextColor));
    LinearLayout.LayoutParams searchParams =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    searchParams.setMargins(dp(24), 0, dp(24), dp(8));
    root.addView(search, searchParams);

    FrameLayout listContainer = new FrameLayout(this);
    appList = new ListView(this);
    appList.setDivider(null);
    appList.setDividerHeight(0);
    appList.setBackgroundColor(backgroundColor);
    listContainer.addView(
        appList,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    progressBar = new ProgressBar(this);
    FrameLayout.LayoutParams progressParams =
        new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER);
    listContainer.addView(progressBar, progressParams);
    LinearLayout.LayoutParams listParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1);
    root.addView(listContainer, listParams);

    TextView reconnectNote = new TextView(this);
    reconnectNote.setText(R.string.app_routing_reconnect_note);
    reconnectNote.setTextSize(13);
    reconnectNote.setTextColor(secondaryTextColor);
    reconnectNote.setPadding(dp(24), dp(10), dp(24), dp(16));
    root.addView(reconnectNote);

    search.addTextChangedListener(
        new TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence value, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence value, int start, int before, int count) {
            if (adapter != null) {
              adapter.filter(value == null ? "" : value.toString());
            }
          }

          @Override
          public void afterTextChanged(Editable value) {}
        });
    return root;
  }

  private void loadApplications() {
    executor.execute(
        () -> {
          PackageManager packageManager = getPackageManager();
          List<ApplicationInfo> installedApplications = getInstalledApplications(packageManager);
          List<String> installedPackages = new ArrayList<>();
          List<ApplicationItem> loadedApps = new ArrayList<>();
          for (ApplicationInfo info : installedApplications) {
            if (getPackageName().equals(info.packageName)) {
              continue;
            }
            installedPackages.add(info.packageName);
            CharSequence label = info.loadLabel(packageManager);
            loadedApps.add(
                new ApplicationItem(
                    info.packageName,
                    label == null || label.length() == 0 ? info.packageName : label.toString()));
          }

          Collator collator = Collator.getInstance(Locale.getDefault());
          loadedApps.sort((first, second) -> collator.compare(first.label, second.label));
          AppRoutingPreferences.initializeDefaultsIfNeeded(this, installedPackages);
          Set<String> storedBypasses = AppRoutingPreferences.getBypassedPackages(this);

          runOnUiThread(
              () -> {
                if (isFinishing() || isDestroyed()) {
                  return;
                }
                allApps.clear();
                allApps.addAll(loadedApps);
                bypassedPackages.clear();
                bypassedPackages.addAll(storedBypasses);
                adapter = new AppListAdapter();
                appList.setAdapter(adapter);
                progressBar.setVisibility(View.GONE);
                updateSelectedCount();
              });
        });
  }

  @SuppressWarnings("deprecation")
  private static List<ApplicationInfo> getInstalledApplications(PackageManager packageManager) {
    return packageManager.getInstalledApplications(PackageManager.GET_META_DATA);
  }

  private void updateSelectedCount() {
    if (selectedCount == null) {
      return;
    }
    int selected = 0;
    for (ApplicationItem item : allApps) {
      if (bypassedPackages.contains(item.packageName)) {
        selected++;
      }
    }
    selectedCount.setText(getString(R.string.app_routing_selected_count, selected, allApps.size()));
  }

  private void toggle(ApplicationItem item) {
    boolean shouldBypass = !bypassedPackages.contains(item.packageName);
    if (shouldBypass) {
      bypassedPackages.add(item.packageName);
    } else {
      bypassedPackages.remove(item.packageName);
    }
    AppRoutingPreferences.setPackageBypassed(this, item.packageName, shouldBypass);
    adapter.notifyDataSetChanged();
    updateSelectedCount();
  }

  private void configureColors() {
    int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
    boolean isDark = nightMode == Configuration.UI_MODE_NIGHT_YES;
    backgroundColor = isDark ? Color.rgb(18, 27, 36) : Color.rgb(246, 248, 249);
    cardColor = isDark ? Color.rgb(28, 42, 54) : Color.WHITE;
    primaryTextColor = isDark ? Color.WHITE : Color.rgb(30, 42, 48);
    secondaryTextColor = isDark ? Color.rgb(183, 196, 204) : Color.rgb(93, 110, 118);
    getWindow().setStatusBarColor(backgroundColor);
    getWindow().setNavigationBarColor(backgroundColor);
    if (!isDark) {
      getWindow()
          .getDecorView()
          .setSystemUiVisibility(
              View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }

  private static final class ApplicationItem {
    final String packageName;
    final String label;

    ApplicationItem(String packageName, String label) {
      this.packageName = packageName;
      this.label = label;
    }
  }

  private final class AppListAdapter extends BaseAdapter {
    private final List<ApplicationItem> visibleApps = new ArrayList<>(allApps);
    private final LruCache<String, Drawable> iconCache = new LruCache<>(64);

    @Override
    public int getCount() {
      return visibleApps.size();
    }

    @Override
    public ApplicationItem getItem(int position) {
      return visibleApps.get(position);
    }

    @Override
    public long getItemId(int position) {
      return getItem(position).packageName.hashCode();
    }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
      RowHolder holder;
      if (convertView == null) {
        holder = createRow();
        convertView = holder.root;
        convertView.setTag(holder);
      } else {
        holder = (RowHolder) convertView.getTag();
      }

      ApplicationItem item = getItem(position);
      holder.label.setText(item.label);
      holder.packageName.setText(item.packageName);
      holder.checkbox.setChecked(bypassedPackages.contains(item.packageName));
      holder.icon.setImageDrawable(loadIcon(item.packageName));
      holder.root.setOnClickListener(view -> toggle(item));
      holder.root.setContentDescription(
          item.label
              + ", "
              + getString(
                  bypassedPackages.contains(item.packageName)
                      ? R.string.app_routing_bypassed
                      : R.string.app_routing_via_vpn));
      return convertView;
    }

    void filter(String query) {
      String normalized = query.trim().toLowerCase(Locale.getDefault());
      visibleApps.clear();
      if (normalized.isEmpty()) {
        visibleApps.addAll(allApps);
      } else {
        for (ApplicationItem item : allApps) {
          if (item.label.toLowerCase(Locale.getDefault()).contains(normalized)
              || item.packageName.toLowerCase(Locale.ROOT).contains(normalized)) {
            visibleApps.add(item);
          }
        }
      }
      notifyDataSetChanged();
    }

    private Drawable loadIcon(String packageName) {
      Drawable cached = iconCache.get(packageName);
      if (cached != null) {
        return cached;
      }
      Drawable icon;
      try {
        icon = getPackageManager().getApplicationIcon(packageName);
      } catch (PackageManager.NameNotFoundException e) {
        icon = getPackageManager().getDefaultActivityIcon();
      }
      iconCache.put(packageName, icon);
      return icon;
    }

    private RowHolder createRow() {
      LinearLayout row = new LinearLayout(AppRoutingActivity.this);
      row.setOrientation(LinearLayout.HORIZONTAL);
      row.setGravity(Gravity.CENTER_VERTICAL);
      row.setPadding(dp(20), dp(9), dp(18), dp(9));
      row.setBackgroundColor(cardColor);
      row.setMinimumHeight(dp(72));

      ImageView icon = new ImageView(AppRoutingActivity.this);
      icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
      row.addView(icon, new LinearLayout.LayoutParams(dp(48), dp(48)));

      LinearLayout labels = new LinearLayout(AppRoutingActivity.this);
      labels.setOrientation(LinearLayout.VERTICAL);
      labels.setPadding(dp(16), 0, dp(10), 0);

      TextView label = new TextView(AppRoutingActivity.this);
      label.setTextSize(18);
      label.setTextColor(primaryTextColor);
      label.setMaxLines(1);
      labels.addView(label);

      TextView packageName = new TextView(AppRoutingActivity.this);
      packageName.setTextSize(12);
      packageName.setTextColor(secondaryTextColor);
      packageName.setMaxLines(1);
      labels.addView(packageName);
      row.addView(labels, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

      CheckBox checkbox = new CheckBox(AppRoutingActivity.this);
      checkbox.setClickable(false);
      checkbox.setFocusable(false);
      checkbox.setButtonTintList(
          new ColorStateList(
              new int[][] {new int[] {android.R.attr.state_checked}, new int[] {}},
              new int[] {ACCENT_COLOR, secondaryTextColor}));
      row.addView(checkbox, new LinearLayout.LayoutParams(dp(48), dp(48)));
      return new RowHolder(row, icon, label, packageName, checkbox);
    }
  }

  private static final class RowHolder {
    final LinearLayout root;
    final ImageView icon;
    final TextView label;
    final TextView packageName;
    final CheckBox checkbox;

    RowHolder(
        LinearLayout root,
        ImageView icon,
        TextView label,
        TextView packageName,
        CheckBox checkbox) {
      this.root = root;
      this.icon = icon;
      this.label = label;
      this.packageName = packageName;
      this.checkbox = checkbox;
    }
  }
}
