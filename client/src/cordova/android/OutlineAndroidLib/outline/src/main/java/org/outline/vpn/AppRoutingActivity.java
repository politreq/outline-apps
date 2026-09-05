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
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.BaseAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
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
  // Same light palette as the web shell. Time-of-day scenes do not change the UI theme.
  private static final int ACCENT_COLOR = Color.rgb(83, 118, 41);
  private static final int BACKGROUND_COLOR = Color.rgb(255, 247, 232);
  private static final int CARD_COLOR = Color.rgb(255, 250, 240);
  private static final int PRIMARY_TEXT_COLOR = Color.rgb(74, 44, 29);
  private static final int SECONDARY_TEXT_COLOR = Color.rgb(128, 99, 78);
  private static final int BORDER_COLOR = Color.rgb(239, 214, 180);
  private static final int SELECTED_COLOR = Color.rgb(237, 244, 216);

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final List<ApplicationItem> allApps = new ArrayList<>();
  private final Set<String> bypassedPackages = new HashSet<>();

  private AppListAdapter adapter;
  private TextView selectedCount;
  private ListView appList;
  private ProgressBar progressBar;
  private EditText search;
  private TextView reconnectMessage;
  private final Runnable hideReconnectMessage =
      () ->
          reconnectMessage
              .animate()
              .alpha(0)
              .setDuration(200)
              .withEndAction(() -> reconnectMessage.setVisibility(View.GONE));

  @Override
  protected void attachBaseContext(Context base) {
    Configuration configuration = new Configuration(base.getResources().getConfiguration());
    configuration.setLocale(new Locale("ru"));
    configuration.uiMode =
        (configuration.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | Configuration.UI_MODE_NIGHT_NO;
    super.attachBaseContext(base.createConfigurationContext(configuration));
  }

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
    if (reconnectMessage != null) {
      reconnectMessage.removeCallbacks(hideReconnectMessage);
      reconnectMessage.animate().cancel();
    }
    super.onDestroy();
  }

  private View buildContentView() {
    LinearLayout root = new LinearLayout(this);
    root.setId(R.id.app_routing_root);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(BACKGROUND_COLOR);
    // Android 15+ enforces edge-to-edge. Apply system/keyboard insets exactly once,
    // on this root, so the toolbar never overlaps the status bar or display cutout.
    root.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Insets safe =
                insets.getInsets(
                    WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
          } else {
            view.setPadding(
                insets.getSystemWindowInsetLeft(),
                insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(),
                insets.getSystemWindowInsetBottom());
          }
          return insets;
        });

    LinearLayout header = new LinearLayout(this);
    header.setId(R.id.app_routing_header);
    header.setGravity(Gravity.CENTER_VERTICAL);
    header.setMinimumHeight(dp(64));
    header.setPadding(dp(12), dp(10), dp(16), dp(10));

    ImageButton back = new ImageButton(this);
    back.setId(R.id.app_routing_back_button);
    back.setImageResource(R.drawable.ic_routing_back);
    back.setImageTintList(ColorStateList.valueOf(PRIMARY_TEXT_COLOR));
    back.setPadding(dp(12), dp(12), dp(12), dp(12));
    back.setBackground(
        new RippleDrawable(
            ColorStateList.valueOf(BORDER_COLOR),
            rounded(Color.rgb(255, 232, 199), 16, BORDER_COLOR),
            null));
    back.setContentDescription(getString(R.string.app_routing_back));
    back.setOnClickListener(view -> finish());
    header.addView(back, new LinearLayout.LayoutParams(dp(44), dp(44)));

    TextView title = new TextView(this);
    title.setId(R.id.app_routing_title_text);
    title.setText(R.string.app_routing_title);
    title.setTextSize(20);
    title.setTextColor(PRIMARY_TEXT_COLOR);
    title.setIncludeFontPadding(false);
    title.setGravity(Gravity.CENTER_VERTICAL);
    title.setPadding(dp(12), 0, 0, 0);
    title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
    header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    root.addView(header);
    View headerLine = new View(this);
    headerLine.setBackgroundColor(BORDER_COLOR);
    root.addView(headerLine, new LinearLayout.LayoutParams(-1, dp(1)));

    LinearLayout summary = new LinearLayout(this);
    summary.setOrientation(LinearLayout.VERTICAL);
    summary.setPadding(dp(18), dp(16), dp(18), dp(16));
    summary.setBackground(rounded(CARD_COLOR, 24, BORDER_COLOR));
    LinearLayout.LayoutParams summaryParams = new LinearLayout.LayoutParams(-1, -2);
    summaryParams.setMargins(dp(12), dp(16), dp(12), dp(12));
    root.addView(summary, summaryParams);

    TextView description = new TextView(this);
    description.setText(R.string.app_routing_description);
    description.setTextSize(15);
    description.setTextColor(SECONDARY_TEXT_COLOR);
    description.setLineSpacing(dp(2), 1);
    summary.addView(description);

    selectedCount = new TextView(this);
    selectedCount.setId(R.id.app_routing_count);
    selectedCount.setTextSize(14);
    selectedCount.setTextColor(ACCENT_COLOR);
    selectedCount.setTypeface(selectedCount.getTypeface(), android.graphics.Typeface.BOLD);
    selectedCount.setPadding(0, dp(12), 0, 0);
    updateSelectedCount();
    summary.addView(selectedCount);

    search = new EditText(this);
    search.setId(R.id.app_routing_search);
    search.setSingleLine(true);
    search.setHint(R.string.app_routing_search_hint);
    search.setTextColor(PRIMARY_TEXT_COLOR);
    search.setHintTextColor(SECONDARY_TEXT_COLOR);
    search.setTextSize(17);
    search.setCompoundDrawablesWithIntrinsicBounds(R.drawable.ic_routing_search, 0, 0, 0);
    search.setCompoundDrawableTintList(ColorStateList.valueOf(SECONDARY_TEXT_COLOR));
    search.setCompoundDrawablePadding(dp(12));
    search.setBackground(rounded(CARD_COLOR, 18, BORDER_COLOR));
    search.setPadding(dp(16), dp(12), dp(16), dp(12));
    search.setMinimumHeight(dp(52));
    LinearLayout.LayoutParams searchParams =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    searchParams.setMargins(dp(12), 0, dp(12), dp(12));
    root.addView(search, searchParams);

    FrameLayout listContainer = new FrameLayout(this);
    listContainer.setBackground(rounded(CARD_COLOR, 24, BORDER_COLOR));
    listContainer.setPadding(dp(1), dp(1), dp(1), dp(1));
    listContainer.setClipToOutline(true);
    appList = new ListView(this);
    appList.setId(R.id.app_routing_list);
    appList.setDivider(new ColorDrawable(BORDER_COLOR));
    appList.setDividerHeight(dp(1));
    appList.setBackgroundColor(CARD_COLOR);
    listContainer.addView(
        appList,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    progressBar = new ProgressBar(this);
    progressBar.setIndeterminateTintList(ColorStateList.valueOf(ACCENT_COLOR));
    FrameLayout.LayoutParams progressParams =
        new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER);
    listContainer.addView(progressBar, progressParams);
    LinearLayout.LayoutParams listParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1);
    listParams.setMargins(dp(12), 0, dp(12), 0);
    root.addView(listContainer, listParams);

    reconnectMessage = new TextView(this);
    reconnectMessage.setId(R.id.app_routing_reconnect_message);
    reconnectMessage.setText(R.string.app_routing_reconnect_popup);
    reconnectMessage.setTextSize(14);
    reconnectMessage.setTextColor(CARD_COLOR);
    reconnectMessage.setBackground(rounded(ACCENT_COLOR, 18, ACCENT_COLOR));
    reconnectMessage.setPadding(dp(16), dp(14), dp(16), dp(14));
    reconnectMessage.setElevation(dp(6));
    reconnectMessage.setVisibility(View.GONE);
    reconnectMessage.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    FrameLayout.LayoutParams messageParams = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
    messageParams.setMargins(dp(12), dp(12), dp(12), dp(12));
    listContainer.addView(reconnectMessage, messageParams);

    TextView reconnectNote = new TextView(this);
    reconnectNote.setText(R.string.app_routing_reconnect_note);
    reconnectNote.setTextSize(13);
    reconnectNote.setTextColor(SECONDARY_TEXT_COLOR);
    reconnectNote.setPadding(dp(24), dp(12), dp(24), dp(12));
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
                adapter.filter(search.getText().toString());
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
    reconnectMessage.removeCallbacks(hideReconnectMessage);
    reconnectMessage.animate().cancel();
    if (reconnectMessage.getVisibility() != View.VISIBLE) {
      reconnectMessage.setAlpha(0);
      reconnectMessage.setVisibility(View.VISIBLE);
    }
    reconnectMessage.animate().alpha(1).setDuration(180).start();
    reconnectMessage.postDelayed(hideReconnectMessage, 5000);
  }

  private void configureColors() {
    getWindow().setStatusBarColor(BACKGROUND_COLOR);
    getWindow().setNavigationBarColor(BACKGROUND_COLOR);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      getWindow().setDecorFitsSystemWindows(false);
    }
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
  }

  private GradientDrawable rounded(int color, int radius, int stroke) {
    GradientDrawable drawable = new GradientDrawable();
    drawable.setColor(color);
    drawable.setCornerRadius(dp(radius));
    drawable.setStroke(dp(1), stroke);
    return drawable;
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
      holder.root.setBackgroundColor(
          bypassedPackages.contains(item.packageName) ? SELECTED_COLOR : CARD_COLOR);
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
      row.setPadding(dp(14), dp(12), dp(10), dp(12));
      row.setBackgroundColor(CARD_COLOR);
      row.setMinimumHeight(dp(80));
      row.setFocusable(true);

      ImageView icon = new ImageView(AppRoutingActivity.this);
      icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
      row.addView(icon, new LinearLayout.LayoutParams(dp(44), dp(44)));
      icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);

      LinearLayout labels = new LinearLayout(AppRoutingActivity.this);
      labels.setOrientation(LinearLayout.VERTICAL);
      labels.setPadding(dp(12), 0, dp(6), 0);

      TextView label = new TextView(AppRoutingActivity.this);
      label.setTextSize(16);
      label.setTextColor(PRIMARY_TEXT_COLOR);
      label.setMaxLines(1);
      label.setEllipsize(TextUtils.TruncateAt.END);
      labels.addView(label);

      TextView packageName = new TextView(AppRoutingActivity.this);
      packageName.setTextSize(12);
      packageName.setTextColor(SECONDARY_TEXT_COLOR);
      packageName.setMaxLines(1);
      packageName.setEllipsize(TextUtils.TruncateAt.END);
      labels.addView(packageName);
      row.addView(labels, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

      CheckBox checkbox = new CheckBox(AppRoutingActivity.this);
      checkbox.setClickable(false);
      checkbox.setFocusable(false);
      checkbox.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
      checkbox.setButtonTintList(
          new ColorStateList(
              new int[][] {new int[] {android.R.attr.state_checked}, new int[] {}},
              new int[] {ACCENT_COLOR, SECONDARY_TEXT_COLOR}));
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
