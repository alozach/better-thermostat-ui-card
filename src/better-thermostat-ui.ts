import {
  TemplateResult,
  LitElement,
  html,
  css,
  PropertyValueMap,
  svg,
  CSSResultGroup,
  PropertyValues
} from 'lit';
import {
  customElement,
  property,
  state
} from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import {
  mdiWindowOpenVariant,
  mdiSunThermometer,
  mdiDotsVertical,
  mdiCalendarSync,
  mdiAutorenew,
  mdiFire,
  mdiSnowflake,
  mdiPower,
  mdiFan,
  mdiWaterPercent,
  mdiLeaf,
  mdiThermometer,
  mdiHeatWave,
  mdiBatteryAlert,
  mdiWifiStrengthOffOutline,
  mdiMinus,
  mdiPlus
} from "@mdi/js";

import {
  CARD_VERSION
} from './const';
import {
  localize
} from './localize/localize';
import {
  ClimateEntity,
  fireEvent,
  formatNumber,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
} from "./ha";

import { ClimateCardConfig } from './climate-card-config';
import './ha/ha-control-circular-slider';

const UNAVAILABLE = "unavailable";
const UNKNOWN = "unknown";
const modeIcons: {
  [mode in any]: string
} = {
  auto: mdiCalendarSync,
  heat_cool: mdiAutorenew,
  heat: mdiFire,
  cool: mdiSnowflake,
  off: mdiPower,
  fan_only: mdiFan,
  dry: mdiWaterPercent,
  window_open: mdiWindowOpenVariant,
  eco: mdiLeaf, 
  summer: mdiSunThermometer,
  temperature:  mdiThermometer,
  humidity: mdiWaterPercent
};

interface RegisterCardParams {
  type: string;
  name: string;
  description: string;
}
export function registerCustomCard(params: RegisterCardParams) {
  const windowWithCards = window as unknown as Window & {
      customCards: unknown[];
  };
  windowWithCards.customCards = windowWithCards.customCards || [];
  windowWithCards.customCards.push({
      ...params,
      preview: true,
  });
}

/* eslint no-console: 0 */
console.info(
  `%c  BetterThermostatUI-CARD \n%c  version: ${CARD_VERSION}    `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

registerCustomCard({
  type: "better-thermostat-ui-card",
  name: "Better Thermostat Climate Card",
  description: "Card for climate entity",
});

@customElement('better-thermostat-ui-card')
export class BetterThermostatUi extends LitElement implements LovelaceCard {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./better-thermostat-ui-card-editor");
    return document.createElement("better-thermostat-ui-card-editor") as LovelaceCardEditor;
  }

  public static async getStubConfig(hass: HomeAssistant): Promise<any> {
      const entities = Object.keys(hass.states);
      const climates = entities.filter((e) => ["climate"].includes(e.split(".")[0]));
      const bt_climate:any = climates.filter((e) => hass.states[e].attributes?.call_for_heat);
      return {
          type: "custom:better-thermostat-ui-card",
          entity: bt_climate[0] || climates[0]
      };
  }

  @property({
      attribute: false
  }) public hass! : HomeAssistant;
  @property({ type: Number }) public value: number = 0;
  @property({ type: Number }) public current: number = 0;
  @property({ type: Number }) public humidity: number = 0;
  @property({ type: Number }) public min = 0;
  @property({ type: Number }) public max = 35;
  @property({ type: Number }) public step = 1;
  @property({ type: Boolean }) public window: boolean = false;
  @property({ type: Boolean }) public summer: boolean = false;
  @property({ type: String }) public status: string = "loading";
  @property({ type: String }) public mode: string = "off";
  @property({ type: Boolean, reflect: true }) public dragging = false;
  @state()
  private changingHigh?: number;

  private _highChanged(ev) {
    this.value = ev.detail.value;
    this._setTemperature();
  }

  private _highChanging(ev) {
    if(typeof(ev.detail.value) !== "number") return;
    this.value = ev.detail.value;
    this._updateDisplay();
    this._vibrate(20);
  }

  private _incValue() {
    this.value += this.step;
    this._updateDisplay();
    this._vibrate(40);
  }

  private _decValue() {
    this.value -= this.step;
    this._updateDisplay();
    this._vibrate(40);
  }

  private _init: Boolean = true;
  private _firstRender: Boolean = true;
  private _ignore: Boolean = false;
  private _hasWindow: Boolean = false;
  private _hasSummer: Boolean = false;
  private _timeout: any;
  private _oldValueMin: number = 0;
  private _oldValueMax: number = 0;
  private stateObj: any | undefined;
  private _display_bottom: number = 0;
  private _display_top: number = 0;
  private modes: any = [];
  private lowBattery: any = {};
  private error: any = [];

  @state() private _config?: ClimateCardConfig;

  setConfig(config: ClimateCardConfig): void {
    this._config = {
        tap_action: {
            action: "toggle",
        },
        hold_action: {
            action: "more-info",
        },
        ...config,
    };
  }

  getCardSize(): number | Promise<number> {
    return 1;
  }

  public static styles: CSSResultGroup = css `
      :host {
          display: block;
          box-sizing: border-box;
          position: relative;
          container: bt-card / inline-size;
      }

      ha-card {
        overflow: hidden;
        height: 100%;
        width: 100%;
        vertical-align: middle;
        justify-content: center;
        justify-items: center;
        padding-left: 1em;
        padding-right: 1em;
        padding-top: 1.5em;
        box-sizing: border-box;
        position: relative;
      }

      bt-ha-outlined-icon-button {
        border: 1px solid var(--secondary-text-color);
        border-radius: 100%;
        padding: 0.5em;
        cursor: pointer;
      }

      .content.battery, bt-ha-control-circular-slider.battery {
        opacity: 0.5;
        filter: blur(5px);
        pointer-events: none;
      }
      

      .low_battery, .error {
        position: absolute;
        display: flex;
        flex-flow: column;
        align-items: center;
        place-content: center;
        width: -webkit-fill-available;
        height: -webkit-fill-available;
        left: 0px;
        top: 0px;
        background: rgba(200, 200, 200, 0.16);
        border-radius: var(--ha-card-border-radius,12px);
        border-width: var(--ha-card-border-width,1px);
        border-style: solid;
        border-color: var(--ha-card-border-color,var(--divider-color,#e0e0e0));
        pointer-events: all;
        font-size: 22px;
        text-align: center;
        line-height: 40px;
        padding: 1em;
        --mdc-icon-size: 40px;

      }

      .unavailable {
          opacity: 0.3;
      }

      .unavailable #bar, .unavailable .main-value, .unavailable #value,.unavailable #current, .unavailable .current-info,
      .unknown #bar, .unknown .main-value, .unknown #value,.unknown #current, .unknown .current-info {
        display: none;
      }

      .more-info {
        position: absolute;
        cursor: pointer;
        top: 0px;
        right: 0px;
        inset-inline-end: 0px;
        inset-inline-start: initial;
        border-radius: 100%;
        color: var(--secondary-text-color);
        z-index: 1;
        direction: var(--direction);
    }
      .container {
          position: relative;
          width: 100%;
          height: 100%;
      }
      bt-ha-control-circular-slider {
        --primary-color: var(--mode-color);
      }

      .content {
        position: absolute;
        width: calc(70% - 40px);
        height: calc(70% - 100px);
        box-sizing: border-box;
        border-radius: 100%;
        left: 50%;
        top: calc(50% - 20px);
        text-align: center;
        overflow-wrap: break-word;
        pointer-events: none;
        display: flex;
        align-items: center;
        place-content: center;
        flex-flow: wrap;
        z-index: 0;
        transform: translate(-50%,-50%);
        max-width: 155px;
      }

      #main {
        transform: scale(2.3);
      }

      .name {
        display: block;
        width: 100%;
        text-align: center;
        font-size: 20px;
        word-break: keep-all;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
    }
      svg {
        height: auto;
        margin: auto;
        display: block;
        width: 100%;
        -webkit-backface-visibility: hidden;
        max-width: 233px;
      }
      
      path {
        stroke-linecap: round;
        stroke-width: 1;
      }

      text {
        fill: var(--primary-text-color);
      }
      .eco {
        --mode-color: var(--energy-non-fossil-color);
      }

      .summer {
        --mode-color: var(--label-badge-yellow)
      }

      .window_open {
        --mode-color: #80a7c4
      }

      .auto,
      .heat_cool {
        --mode-color: var(--state-climate-auto-color);
      }
      .cool {
        --mode-color: var(--state-climate-cool-color);
      }
      .heat {
        --mode-color: var(--label-badge-red);
      }
      .manual {
        --mode-color: var(--state-climate-manual-color);
      }
      .off {
        --mode-color: var(--slider-track-color);
      }
      .fan_only {
        --mode-color: var(--state-climate-fan_only-color);
      }
      .dry {
        --mode-color: var(--state-climate-dry-color);
      }
      .idle {
        --mode-color: var(--state-climate-idle-color);
      }
      .unknown-mode {
        --mode-color: var(--state-unknown-color);
      }

      #modes {
        z-index: 3;
        position: relative;
        display: flex;
        width: auto;
        justify-content: center;
        margin-top: -3em;
        margin-bottom: 1em;
      }

      #bt-control-buttons {
        z-index: 3;
        position: relative;
        display: flex;
        width: auto;
        justify-content: center;
        padding-bottom: 0.2em;
      }

      #bt-control-buttons .button {
        z-index: 3;
        position: relative;
        display: flex;
        width: auto;
        justify-content: center;
        padding: 1em;
        padding-top: 0.2em;
      }

      #modes > * {
        color: var(--disabled-text-color);
        cursor: pointer;
        display: inline-block;
      }
      #modes .selected-icon {
        color: var(--mode-color);
      }
      
      #shadowpath {
        stroke: #e7e7e8;
      }

      #value {
        fill: var(--mode-color);
        r: 5;
        z-index: 9999 !important;
        transition: r 0.3s ease-in-out, fill 0.6s ease-in-out;
      }

      #value,#current {
        filter: drop-shadow(0px 0px 1px #000);
      }

      #value:hover, #value:active, #value:focus, #value.active {
        r: 8 !important;
      }

      #current {
        pointer-events: none;
        fill: var(--label-badge-grey);
      }
      
      .status {
        transition: fill 0.6s ease-in-out, filter 0.6s ease-in-out;
        filter: none;
      }
      .status.active {
        fill: var(--error-color);
        filter: drop-shadow(0px 0px 6px var(--error-color));
      }

      #bar {
        stroke: var(--mode-color);
        stroke-dasharray: 176;
        stroke-dashoffset: 0;
        transition: stroke-dashoffset 5.1s ease-in-out 0s, stroke 0.6s ease-in-out;
      }

      #bar.drag {
        transition: none !important;
      }
      #c-minus,#c-plus {
        cursor: pointer;
      }
      .control {
        cursor: pointer;
        pointer-events: none;
      }
      ha-icon-button {
        transition: color 0.6s ease-in-out;
      }
      .eco ha-icon-button[title="heat"], .window_open ha-icon-button[title="heat"], .summer ha-icon-button[title="heat"] {
        --mode-color: var(--disabled-text-color);
      }
      .summer,.window {
        transition: fill 0.3s ease;
        fill: var(--disabled-text-color);
      }
      line {
        stroke: var(--disabled-text-color);
      }
      .summer.active {
        fill: var(--label-badge-yellow);
      }
      .window.active {
        fill: #80a7c4;
      }
      ha-icon-button[title="eco"] {
        --mode-color: var(--energy-non-fossil-color) !important;
      }

      @container bt-card (max-width: 255px) {
        #modes {
          margin-top: -2em;
        }
        ha-card {
          padding-top: 2em;
        }
        .content {
          width: calc(90% - 40px);
          top: calc(50% - 20px);
        }
      }
  `;

  private _vibrate(delay:number) {
    try {
      navigator.vibrate(delay);
    } catch(e){}
  }

  protected firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
    this._init = false;
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (changedProps.has("_config") !== undefined) {
      if(changedProps.get("_config") !== undefined) {
        this._hasSummer = false;
        this._hasWindow = false;
        this.humidity = 0;
      }
    }
    if (changedProps.get("hass") !== undefined) {
      this._init = false;
    }
    return true;
  }

  protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
    super.updated(changedProperties);
    this._firstRender = false;

    this?.shadowRoot?.querySelector('.low_battery')?.addEventListener('click', () => {
      this?.shadowRoot?.querySelector('.low_battery')?.remove();
      this?.shadowRoot?.querySelector('.content')?.classList.remove('battery');
      this._vibrate(2);
    });
  }

  public willUpdate(changedProps: PropertyValues) {
      if (!this.hass || !this._config || (!changedProps.has("hass") && !changedProps.has("_config"))) {
          return;
      }

      const entity_id:any = this._config.entity;

      const stateObj = this.hass.states[entity_id] as ClimateEntity;
      if (!stateObj) {
          return;
      }
      const oldHass = changedProps.get("hass") as HomeAssistant | undefined;

      if (!oldHass || oldHass.states[entity_id] !== stateObj) {
        if (!this._config || !this.hass || !this._config.entity) return;
  
        this.stateObj = stateObj;
        const attributes = this.stateObj.attributes;
        const stateMode = this.stateObj.state;
  
        this.mode = stateMode || "off";

        if (attributes.hvac_modes) {
          this.modes = Object.values(attributes.hvac_modes);
        }
  
        if (attributes.temperature) {
          this.value = attributes.temperature;
        }
        if (attributes.target_temp_step) {
          this.step = attributes.target_temp_step;
        }
        if (attributes.min_temp) {
          this.min = attributes.min_temp;
        }
        if (attributes.max_temp) {
          this.max = attributes.max_temp;
        }
        if (attributes.current_temperature) {
          this.current = attributes.current_temperature;
        }
        if (attributes?.humidity !== undefined) {
          this.humidity = parseFloat(attributes.humidity);
        }
        if (attributes?.window_open !== undefined) {
          this._hasWindow = true;
          this.window = attributes.window_open;
        }
        if (attributes?.call_for_heat !== undefined) {
          this._hasSummer = true;
          this.summer = !attributes.call_for_heat
        }
        if (attributes?.batteries !== undefined && !this?._config?.disable_battery_warning) {
          const batteries = Object.entries(JSON.parse(attributes.batteries));
          const lowBatteries = batteries.filter((entity: any) => entity[1].battery < 10);
          if (lowBatteries.length > 0) {
            this.lowBattery = lowBatteries.map((data:any) => {return {"name": data[0], "battery": data[1].battery}})[0];
          } else {
            this.lowBattery = null;
          }
        } else {
          this.lowBattery = null;
        }
        if (attributes?.errors !== undefined) {
          const errors = JSON.parse(attributes.errors);
          if (errors.length > 0) {
            this.error = errors[0];
          } else {
            this.error = [];
          }
        } else {
          this.error = [];
        }
        this._updateDisplay();
      }
  }

  private _updateDisplay() {
    if(this?._config?.set_current_as_main) {
      this._display_bottom = this.value;
      this._display_top = this.current;
    } else {
      this._display_bottom = this.current;
      this._display_top = this.value;
    }
  }

  private _handleAction(e: MouseEvent): void {
    if ((e.currentTarget as any).mode === "eco") {
        const saved_temp = this?.stateObj?.attributes?.saved_temperature || null;
        if (saved_temp === null) {
          this.hass!.callService("better_thermostat", "set_temp_target_temperature", {
              entity_id: this._config!.entity,
              temperature: this._config?.eco_temperature || 18,
          });
        } else {
          this.hass!.callService("better_thermostat", "restore_saved_target_temperature", {
              entity_id: this._config!.entity,
          });
        }
    } else {
      const saved_temp = this?.stateObj?.attributes?.saved_temperature || null;
      if (saved_temp !== null) {
        this.hass!.callService("better_thermostat", "restore_saved_target_temperature", {
            entity_id: this._config!.entity,
        });
      }
      this.hass!.callService("climate", "set_hvac_mode", {
        entity_id: this._config!.entity,
        hvac_mode: (e.currentTarget as any).mode,
      });
    }
  }

  private _setTemperature(): void {
      this.hass!.callService("climate", "set_temperature", {
          entity_id: this._config!.entity,
          temperature: this.value,
      });
  }

  private _renderIcon(mode: string, currentMode: string): TemplateResult {
    if (!modeIcons[mode]) {
        return html ``;
    }
    const localizeMode = this.hass!.localize(`component.climate.state._.${mode}`) || localize({ hass: this.hass, string: `extra_states.${mode}` });
    return html `
      <ha-icon-button
        title="${currentMode === mode ? mode : ''}"
        class=${classMap({ "selected-icon": currentMode === mode })}
        .mode=${mode}
        @click=${this._handleAction}
        tabindex="0"
        .path=${modeIcons[mode]}
        .label=${localizeMode}
      >
      </ha-icon-button>
    `;
  }

  private _handleMoreInfo() {
    fireEvent(this, "hass-more-info", {
        entityId: this._config!.entity,
    });
  }

  public render: () => TemplateResult = (): TemplateResult => {
    return html `
    <ha-card id="${this?._config?.disable_buttons ? '' : 'expand'}" class=${classMap({
      [this.mode]: true,
    })}
    >
    ${this._config?.disable_menu ? `` : html`
      <ha-icon-button
        class="more-info"
        .label=${this.hass!.localize(
          "ui.panel.lovelace.cards.show_more_info"
        )}
        .path=${mdiDotsVertical}
        @click=${this._handleMoreInfo}
        tabindex="0"
      ></ha-icon-button>
      `}
      <div class="name">${this._config?.name}</div>
      ${this.lowBattery !== null ? html`
        <div class="low_battery">
          <ha-icon-button class="alert" .path=${mdiBatteryAlert}>
          </ha-icon-button>
          <span>${this.lowBattery.name}</span>
          <span>${this.lowBattery.battery}%</span>
        </div>
      ` : ``}
      ${this.error.length > 0 ? html`
        <div class="error">
          <ha-icon-button class="alert" .path=${mdiWifiStrengthOffOutline}>
          </ha-icon-button>
          <span>${this.error}</span>
        </div>
      ` : ``}
      <bt-ha-control-circular-slider
      class="${(this?.stateObj?.attributes?.saved_temperature && this?.stateObj?.attributes?.saved_temperature !== null) ? 'eco' : ''} ${this.lowBattery !== null || this.error.length > 0 ? 'battery': ''} ${this.window ? 'window_open': ''}  ${this.summer ? 'summer': ''} "
      .inactive=${this.window}
      .mode="start"
      @value-changed=${this._highChanged}
      @value-changing=${this._highChanging}
      .value=${this.value}
      .current=${this.current}
      step=${this.step}
      min=${this.min}
      max=${this.max}
    >
      <div class="content ${this.lowBattery !== null || this.error.length > 0 ? 'battery': ''} ${this.window ? 'window_open': ''}  ${(this?.stateObj?.attributes?.saved_temperature && this?.stateObj?.attributes?.saved_temperature !== null) ? 'eco' : ''} ${this.summer ? 'summer': ''} ">
            <svg id="main" viewbox="0 0 125 100">
              <g transform="translate(57.5,37) scale(0.35)">
                ${(this._hasWindow && !this._config?.disable_window) ? svg`
                  <path title="${localize({ hass: this.hass, string: `extra_states.window_open` })}" class="window ${this.window ? 'active': ''}" fill="none" transform="${(this._hasSummer && !this._config?.disable_summer) ? 'translate(-31.25,0)' :''}" id="window" d=${mdiWindowOpenVariant} />
                `: ``}
                ${(this._hasSummer && !this._config?.disable_summer) ? svg`
                  <path class="summer ${this.summer ? 'active': ''}" fill="none" transform="${(this._hasWindow && !this._config?.disable_window) ? 'translate(31.25,0)' :''}" id="summer" d=${mdiSunThermometer} />
                `: ``}
              </g>



              <text class="main-value" x="62.5" y="60%" dominant-baseline="middle" text-anchor="middle" style="font-size:15px;">
                ${svg`${formatNumber(
                  this._display_top,
                  this.hass.locale,
                  { minimumFractionDigits: 1, maximumFractionDigits: 1 }
                )}`}
                <tspan dx="-2" dy="-5.5" style="font-size: 5px;">
                  ${svg`
                    ${this.hass.config.unit_system.temperature}
                  `}
                </tspan>
              </text>
              ${(this?.stateObj?.state === UNAVAILABLE || this?.stateObj?.state === UNKNOWN) ? svg`
              <text x="62.5" y="63%" dominant-baseline="middle" text-anchor="middle" style="font-size:6px;">${this.hass!.localize(
                "state.default.unavailable"
              )}</text>
              ` : ''}
              <line x1="35" y1="72" x2="90" y2="72" stroke="#e7e7e8" stroke-width="0.5" />
              <g class="current-info" transform="translate(62.5,80)">
                ${(this.humidity === 0) ? svg`
                    <text x="-5%" y="0%" dominant-baseline="middle" text-anchor="middle" style="font-size:6px;">
                    ${svg`${formatNumber(
                      this.current,
                      this.hass.locale,
                      { minimumFractionDigits: 1, maximumFractionDigits: 1 }
                    )}`}
                    <tspan dx="-1" dy="-2" style="font-size: 3px;">
                      ${svg`
                        ${this.hass.config.unit_system.temperature}
                      `}
                    </tspan>
                  </text>
                  <path class="status ${(this.stateObj.attributes.hvac_action === 'heating' && this.mode !== 'off') ? 'active': ''}"  transform="translate(5,-4) scale(0.25)" fill="#9d9d9d"  d="${mdiHeatWave}" />
                `: svg `
                  <text x="-12.25%" y="0%" dominant-baseline="middle" text-anchor="middle" style="font-size:6px;">
                    ${svg`${formatNumber(
                      this._display_bottom,
                      this.hass.locale,
                      { minimumFractionDigits: 1, maximumFractionDigits: 1 }
                    )}`}
                    <tspan dx="-0.3" dy="-2" style="font-size: 3px;">
                      ${svg`
                        ${this.hass.config.unit_system.temperature}
                      `}
                    </tspan>
                  </text>
                  <text x="12.25%" y="0%" dominant-baseline="middle" text-anchor="middle" style="font-size:6px;">
                    ${svg`${formatNumber(
                      this.humidity,
                      this.hass.locale,
                      { minimumFractionDigits: 1, maximumFractionDigits: 1 }
                    )}`}
                    <tspan dx="-0.3" dy="-2" style="font-size: 3px;">
                    %
                    </tspan>
                  </text>
                  <path class="status ${(this.stateObj.attributes.hvac_action === 'heating' && this.mode !== 'off') ? 'active': ''}"  transform="translate(-3,-3.5) scale(0.25)" fill="#9d9d9d"  d=${mdiHeatWave} />
                `}

              </g>
                </svg>
            </div>
            </bt-ha-control-circular-slider>
            <div id="modes">
              ${this?._hasSummer ? svg`
                ${this?._config?.disable_heat ? html `` : this._renderIcon("heat", this.mode)}
                ${this?._config?.disable_eco ? html `` :
                  this?.stateObj?.attributes?.saved_temperature &&
                  this?.stateObj?.attributes?.saved_temperature !== "none" &&
                  this?.stateObj?.state !== UNAVAILABLE
                    ? this._renderIcon("eco","eco"): this._renderIcon("eco", "none")}
                ${this?._config?.disable_off ? html `` : this._renderIcon("off", this.mode)}
              `:
              svg`
                ${this.modes.map((mode) => {
                  if(this._config?.disable_heat && mode === "heat") return html ``;
                  if(this._config?.disable_eco && mode === "eco") return html ``;
                  if(this._config?.disable_off && mode === "off") return html ``;
                  return this._renderIcon(mode, this.mode);
                })}
              `}

            </div>
            ${this?._config?.disable_buttons ? html`` : html`
            <div id="bt-control-buttons">
                <div class="button">
                  <bt-ha-outlined-icon-button
                      @click=${this._decValue}
                  >
                    <ha-svg-icon .path=${mdiMinus}></ha-svg-icon>
                  </bt-ha-outlined-icon-button>
                </div>
                <div class="button">
                  <bt-ha-outlined-icon-button 
                    @click=${this._incValue}
                  >
                  <ha-svg-icon .path=${mdiPlus}></ha-svg-icon>
                </bt-ha-outlined-icon-button>
                </div>
            </div>
            `}
          </div>
  </ha-card>
  `;
  };
}

/*
              <!--<g transform="translate(62.5,80)">  
                <circle id="c-minus" cx="-20" cy="0" r="5" fill="#e7e7e8" />
                <path  class="control" transform="translate(-24,-4) scale(0.35)" d=${mdiMinus} />
                <circle id="c-plus" cx="20" cy="0" r="5" fill="#e7e7e8" />
                <path  class="control" transform="translate(16,-4) scale(0.35)" d=${mdiPlus} />
              </g>-->
*/
