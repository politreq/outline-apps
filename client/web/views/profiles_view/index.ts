// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

import {css, html, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

import {
  hasActiveConnection,
  selectedProfile,
} from '../servers_view/profile_selection';
import {ServerListItem} from '../servers_view/server_list_item';

@customElement('profiles-view')
export class ProfilesView extends LitElement {
  @property({type: Array}) servers: ServerListItem[] = [];
  @property({type: String}) selectedServerId = '';

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      width: 100%;
      max-width: 440px;
      margin: 0 auto;
      height: calc(100vh - 64px - var(--outline-safe-area-top, 0px));
      overflow-y: auto;
      padding: 20px 12px max(24px, env(safe-area-inset-bottom));
      color: #4a2c1d;
      font-family: var(--outline-font-family, Roboto, sans-serif);
    }
    .active-profile {
      margin: 0 8px 18px;
      color: #80634e;
      text-align: center;
      font-size: 16px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .active-profile strong {
      color: #4a2c1d;
      font-weight: 600;
    }
    .profiles-panel {
      overflow: hidden;
      background: #fffaf0;
      border: 1px solid #efd6b4;
      border-radius: 24px;
      box-shadow: 0 10px 26px rgb(113 75 44 / 7%);
    }
    .section-heading {
      display: flex;
      min-height: 52px;
      padding: 0 18px;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #efd6b4;
    }
    h2 {
      margin: 0;
      font-size: 20px;
    }
    .profile-count {
      display: grid;
      min-width: 28px;
      height: 28px;
      place-items: center;
      color: #80634e;
      background: #f8ead6;
      border-radius: 50%;
      font-size: 13px;
      font-weight: 700;
    }
    .profile-row {
      display: flex;
      min-height: 78px;
      padding: 12px 16px;
      box-sizing: border-box;
      gap: 14px;
      align-items: center;
      border-bottom: 1px solid #efd6b4;
      cursor: pointer;
      transition: background 180ms ease;
    }
    .profile-row:last-child {
      border-bottom: 0;
    }
    .profile-row.selected {
      background: #edf4d8;
    }
    .profile-row:focus-within {
      outline: 2px solid #537629;
      outline-offset: -3px;
    }
    input {
      flex: 0 0 28px;
      width: 28px;
      height: 28px;
      margin: 0;
      appearance: none;
      border: 2px solid #b29987;
      border-radius: 50%;
      background: #fffaf0;
      cursor: pointer;
    }
    input:checked {
      border-color: #537629;
      background: radial-gradient(circle, #537629 52%, #fffaf0 56%);
    }
    .profile-copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 5px;
    }
    .profile-copy strong {
      font-size: 17px;
      font-weight: 600;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .profile-copy small {
      color: #80634e;
      font-size: 13px;
    }
    .profile-copy small.connected {
      color: #537629;
      font-weight: 600;
    }
    .hint,
    .empty {
      margin: 18px 8px 0;
      color: #80634e;
      font-size: 14px;
      line-height: 1.5;
      text-align: center;
    }
    .empty {
      margin: 24px 18px;
    }
    button {
      display: block;
      margin: 16px auto 24px;
      padding: 14px 20px;
      color: #fffaf0;
      background: #537629;
      border: 0;
      border-radius: 16px;
      font: inherit;
      cursor: pointer;
    }
  `;

  private select(serverId: string) {
    this.dispatchEvent(
      new CustomEvent('SelectProfile', {
        detail: {serverId},
        bubbles: true,
        composed: true,
      })
    );
  }

  private addProfile() {
    this.dispatchEvent(
      new CustomEvent('ShowAddServerDialog', {bubbles: true, composed: true})
    );
  }

  render() {
    const selected = selectedProfile(this.servers, this.selectedServerId);
    return html`
      ${selected
        ? html`<p class="active-profile">
            Профиль: <strong>${selected.name}</strong>
          </p>`
        : ''}
      <section class="profiles-panel" aria-label="Профили">
        <div class="section-heading">
          <h2>Профили</h2>
          <span class="profile-count">${this.servers.length}</span>
        </div>
        ${this.servers.map(
          profile => html`
            <label
              class="profile-row ${profile.id === selected?.id
                ? 'selected'
                : ''}"
            >
              <input
                type="radio"
                name="profile"
                value=${profile.id}
                .checked=${profile.id === selected?.id}
                @change=${() => this.select(profile.id)}
              />
              <span class="profile-copy">
                <strong>${profile.name}</strong>
                <small class=${hasActiveConnection(profile) ? 'connected' : ''}>
                  ${hasActiveConnection(profile)
                    ? 'VPN включён'
                    : profile.id === selected?.id
                      ? 'выбран для подключения'
                      : 'дополнительный профиль'}
                </small>
              </span>
            </label>
          `
        )}
        ${!selected
          ? html`
              <p class="empty">
                Пока нет профилей. Добавьте ключ доступа к своему VPN.
              </p>
              <button type="button" @click=${this.addProfile}>
                Добавить профиль
              </button>
            `
          : ''}
      </section>
      ${selected
        ? html`<p class="hint">
            Выберите профиль, затем включите VPN кнопкой на двери на главной
            странице.
          </p>`
        : ''}
    `;
  }
}
