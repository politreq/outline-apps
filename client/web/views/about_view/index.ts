/*
  Copyright 2024 The Outline Authors
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
       http://www.apache.org/licenses/LICENSE-2.0
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import {css, html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

import {
  AndroidAppUpdater,
  AppRelease,
  isAndroidAppUpdateSupported,
} from '../../app/app_update';

type UpdateStatus =
  | 'unsupported'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'permission'
  | 'installing'
  | 'error';

@customElement('about-view')
export class AboutView extends LitElement {
  @property({type: Boolean}) darkMode = false;
  @property({type: Object}) localize!: (
    key: string,
    ...args: string[]
  ) => string;
  @property({type: String}) version!: string;
  @property({type: String}) build!: string;

  @state() private updateStatus: UpdateStatus = 'unsupported';
  @state() private updateRelease?: AppRelease;
  @state() private downloadedUpdatePath = '';
  @state() private downloadProgress = 0;

  private readonly appUpdater = new AndroidAppUpdater();

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      font-family: var(--outline-font-family);
      height: 100%;
      justify-content: space-between;
      margin: 0 auto;
      max-width: 600px;
      text-align: center;
      width: 100%;
      color: var(--outline-text-color);
      background-color: var(--outline-background);
    }

    /* Prevent images from being selectable on iOS, which can cause a crash when trying to save them. */
    img {
      pointer-events: none;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }

    article {
      height: 100%;
      overflow-y: auto;
      padding: calc(32px + var(--outline-safe-area-top)) 24px 0 24px;
    }

    .about-brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: #4a2c1d;
    }

    .about-brand span {
      display: grid;
      width: 76px;
      height: 76px;
      place-items: center;
      background: #c85f3f;
      border-radius: 26px;
    }

    .about-brand md-icon {
      color: #fff9eb;
      font-size: 48px;
    }

    .about-brand h1 {
      margin: 0;
      font-size: 24px;
    }

    header h2 {
      color: var(--outline-label-color);
      font-size: 12px;
      margin: 8px auto;
    }

    section {
      color: var(--outline-text-color);
      font-size: 16px;
      line-height: 22px;
      margin: 32px auto;
      text-align: left;
    }

    .update-panel {
      display: flex;
      margin: 24px auto;
      padding: 18px;
      flex-direction: column;
      gap: 15px;
      color: #4a2c1d;
      background: #fffaf0;
      border: 1px solid #efd6b4;
      border-radius: 22px;
      box-shadow: 0 9px 24px rgb(89 55 30 / 10%);
    }

    .version-row {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
    }

    .version-icon {
      display: grid;
      width: 44px;
      height: 44px;
      place-items: center;
      color: #fff9eb;
      background: #c85f3f;
      border-radius: 15px;
    }

    .version-icon md-icon {
      color: inherit;
      font-size: 26px;
    }

    .version-copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 2px;
    }

    .version-copy small {
      color: #8f7465;
      font-size: 12px;
    }

    .version-copy strong {
      font-size: 18px;
    }

    .update-status {
      display: flex;
      min-height: 45px;
      margin: 0;
      padding: 11px 13px;
      gap: 9px;
      align-items: center;
      color: #537629;
      background: #edf4d8;
      border-radius: 15px;
      font-size: 14px;
      font-weight: 650;
      line-height: 1.35;
    }

    .update-status.error {
      color: #8b5d56;
      background: #f3e4df;
    }

    .update-status md-icon {
      flex: 0 0 auto;
      color: inherit;
      font-size: 21px;
    }

    .update-notes {
      margin: -6px 2px 0;
      color: #8f7465;
      font-size: 13px;
      line-height: 1.4;
    }

    .download-progress {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 38px;
      gap: 10px;
      align-items: center;
    }

    .download-progress progress {
      width: 100%;
      height: 10px;
      overflow: hidden;
      appearance: none;
      background: #dce7bd;
      border: 0;
      border-radius: 999px;
    }

    .download-progress progress::-webkit-progress-bar {
      background: #dce7bd;
      border-radius: 999px;
    }

    .download-progress progress::-webkit-progress-value {
      background: #769b37;
      border-radius: 999px;
      transition: width 220ms ease;
    }

    .download-progress progress::-moz-progress-bar {
      background: #769b37;
      border-radius: 999px;
    }

    .download-progress strong {
      color: #537629;
      font-size: 13px;
      text-align: right;
    }

    .update-action {
      min-height: 46px;
      padding: 0 18px;
      color: white;
      background: #537629;
      border: 0;
      border-radius: 15px;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }

    .update-action:disabled {
      cursor: default;
      opacity: 0.6;
    }

    a {
      color: var(--outline-primary);
      text-decoration: none;
    }

    footer {
      margin: 48px 0 36px 0;
      text-align: center;
    }

    footer img {
      width: 120px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (isAndroidAppUpdateSupported()) {
      void this.checkForUpdate();
    }
  }

  private async checkForUpdate() {
    this.updateStatus = 'checking';
    this.downloadProgress = 0;
    try {
      const result = await this.appUpdater.check();
      this.updateRelease = result;
      this.updateStatus = result.available ? 'available' : 'current';
    } catch (error) {
      console.error('Manual app update check failed', error);
      this.updateStatus = 'error';
    }
  }

  private async downloadUpdate() {
    this.updateStatus = 'downloading';
    this.downloadProgress = 0;
    try {
      const update = await this.appUpdater.download(progress => {
        this.downloadProgress = progress.percent;
      });
      this.updateRelease = update;
      this.downloadedUpdatePath = update.filePath;
      await this.installUpdate();
    } catch (error) {
      console.error('Manual app update download failed', error);
      this.updateStatus = 'error';
    }
  }

  private async installUpdate() {
    if (!this.downloadedUpdatePath) {
      await this.downloadUpdate();
      return;
    }
    try {
      const result = await this.appUpdater.install(this.downloadedUpdatePath);
      this.updateStatus =
        result.status === 'permission_required' ? 'permission' : 'installing';
    } catch (error) {
      console.error('Manual app update installer failed', error);
      this.updateStatus = 'error';
    }
  }

  private async handleUpdateAction() {
    if (this.updateStatus === 'available') {
      await this.downloadUpdate();
    } else if (
      this.updateStatus === 'permission' ||
      this.updateStatus === 'installing'
    ) {
      await this.installUpdate();
    } else {
      await this.checkForUpdate();
    }
  }

  private get updateStatusContent() {
    switch (this.updateStatus) {
      case 'checking':
        return {icon: 'sync', text: 'Проверяем наличие обновлений…'};
      case 'current':
        return {icon: 'check_circle', text: 'Установлена последняя версия'};
      case 'available':
        return {
          icon: 'system_update',
          text: `Доступна версия ${this.updateRelease?.versionName ?? ''}`,
        };
      case 'downloading':
        return {
          icon: 'download',
          text:
            this.downloadProgress < 100
              ? `Скачиваем обновление — ${this.downloadProgress}%`
              : 'Проверяем загруженное обновление…',
        };
      case 'permission':
        return {
          icon: 'security',
          text: 'Разрешите установку обновлений для «В домике»',
        };
      case 'installing':
        return {
          icon: 'install_mobile',
          text: 'Подтвердите обновление в системном окне Android',
        };
      default:
        return {icon: 'error', text: 'Не удалось проверить обновления'};
    }
  }

  private get updateActionLabel() {
    switch (this.updateStatus) {
      case 'available':
        return `Обновить до ${this.updateRelease?.versionName ?? ''}`;
      case 'permission':
        return 'Продолжить';
      case 'installing':
        return 'Открыть установщик';
      case 'error':
        return 'Повторить проверку';
      default:
        return 'Проверить обновления';
    }
  }

  private renderUpdatePanel() {
    if (this.updateStatus === 'unsupported') return html``;
    const content = this.updateStatusContent;
    const busy =
      this.updateStatus === 'checking' || this.updateStatus === 'downloading';
    return html`
      <section class="update-panel" aria-label="Обновления приложения">
        <div class="version-row">
          <span class="version-icon"><md-icon>home</md-icon></span>
          <span class="version-copy">
            <small>Текущая версия</small>
            <strong>${this.version} (${this.build})</strong>
          </span>
        </div>
        <p
          class="update-status ${this.updateStatus === 'error' ? 'error' : ''}"
          role="status"
          aria-live="polite"
        >
          <md-icon>${content.icon}</md-icon>
          <span>${content.text}</span>
        </p>
        ${this.updateStatus === 'downloading'
          ? html`<div class="download-progress">
              <progress
                aria-label="Скачивание обновления"
                max="100"
                value=${this.downloadProgress}
              ></progress>
              <strong>${this.downloadProgress}%</strong>
            </div>`
          : ''}
        ${this.updateStatus === 'available' && this.updateRelease?.releaseNotes
          ? html`<p class="update-notes">${this.updateRelease.releaseNotes}</p>`
          : ''}
        <button
          class="update-action"
          type="button"
          ?disabled=${busy}
          @click=${() => this.handleUpdateAction()}
        >
          ${busy ? 'Подождите…' : this.updateActionLabel}
        </button>
      </section>
    `;
  }

  render() {
    return html`
      <article>
        <header>
          <div class="about-brand">
            <span><md-icon>home</md-icon></span>
            <h1>В домике</h1>
          </div>
          <h2>
            ${this.localize('version', 'appVersion', this.version)}
            (${this.build})
          </h2>
        </header>
        ${this.renderUpdatePanel()}
        <section
          id="about-outline-content"
          .innerHTML=${this.localize(
            'about-outline',
            'shadowsocksUrl',
            'https://shadowsocks.org'
          )}
        ></section>
      </article>
    `;
  }
}
