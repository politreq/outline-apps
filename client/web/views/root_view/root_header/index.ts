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

import {LitElement, html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';

@customElement('root-header')
export class RootHeader extends LitElement {
  @property({type: String}) title = '';
  @property({type: Boolean}) showBackButton = false;
  @property({type: Boolean}) showAddButton = false;

  static styles = css`
    header {
      align-items: center;
      justify-content: space-between;
      background-color: #fff7e8;
      display: flex;
      box-sizing: border-box;
      min-height: calc(64px + var(--outline-safe-area-top));
      padding: var(--outline-safe-area-top) 12px 0 12px;
      border-bottom: 1px solid #efd6b4;
    }

    h1 {
      color: #4a2c1d;
      font-family: 'Roboto', sans-serif;
      font-size: 24px;
      font-weight: 500;
      margin: 0;
      user-select: none;
    }

    md-icon {
      color: #4a2c1d;
    }

    md-icon-button {
      background: #ffe8c7;
      border: 1px solid #f2cca0;
      border-radius: 16px;
    }

    .title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .title-mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      background: #c85f3f;
      border-radius: 12px;
    }

    .title-mark md-icon {
      color: #fff9eb;
      font-size: 22px;
    }

    .hidden {
      visibility: hidden;
    }
    header.home-header {
      justify-content: flex-start;
      gap: 16px;
      padding-inline: 16px;
      border-bottom: 0;
    }
    .home-header md-icon-button {
      background: transparent;
      border-color: transparent;
    }
    .home-header .title {
      gap: 8px;
    }
    .home-header h1 {
      font-size: 24px;
      font-weight: 700;
    }
    .home-header .hidden {
      display: none;
    }
    .home-header .add-button {
      margin-left: auto;
    }
  `;

  render() {
    return html`<header class=${!this.showBackButton ? 'home-header' : ''}>
      ${this.showBackButton
        ? html`<md-icon-button aria-label="Домой" @click=${this.returnHome}>
            <md-icon>arrow_back</md-icon>
          </md-icon-button>`
        : html`<md-icon-button
            aria-label="Открыть меню"
            @click=${this.openNavigation}
          >
            <md-icon>menu</md-icon>
          </md-icon-button>`}
      <div class="title">
        <span class="title-mark"><md-icon>home</md-icon></span>
        <h1>${this.title || 'В домике'}</h1>
      </div>
      <md-icon-button
        class=${classMap({'add-button': true, hidden: !this.showAddButton})}
        aria-label="Добавить профиль"
        @click=${this.openAddAccessKey}
      >
        <md-icon>add</md-icon>
      </md-icon-button>
    </header>`;
  }

  openAddAccessKey() {
    this.dispatchEvent(
      new CustomEvent('ShowAddServerDialog', {
        bubbles: true,
        composed: true,
      })
    );
  }

  openNavigation() {
    this.dispatchEvent(
      new CustomEvent('ShowNavigation', {
        bubbles: true,
        composed: true,
      })
    );
  }

  returnHome() {
    this.dispatchEvent(
      new CustomEvent('ChangePage', {
        detail: {page: 'home'},
        bubbles: true,
        composed: true,
      })
    );
  }
}
