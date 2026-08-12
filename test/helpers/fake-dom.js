'use strict';

class FakeClassList {
    constructor(owner) {
        this.owner = owner;
    }

    add(...names) {
        names.forEach(name => this.owner._classes.add(name));
    }

    remove(...names) {
        names.forEach(name => this.owner._classes.delete(name));
    }

    toggle(name, force) {
        const shouldAdd = force === undefined ? !this.owner._classes.has(name) : Boolean(force);
        if (shouldAdd) this.owner._classes.add(name);
        else this.owner._classes.delete(name);
        return shouldAdd;
    }

    contains(name) {
        return this.owner._classes.has(name);
    }
}

function dataProperty(name) {
    return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function dataAttribute(name) {
    return name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
}

class FakeElement {
    constructor(tagName = 'div', ownerDocument = null) {
        this.tagName = String(tagName).toUpperCase();
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
        this.children = [];
        this.attributes = new Map();
        this.handlers = new Map();
        this._classes = new Set();
        this._textContent = '';
        this._innerHTML = '';
        this.hidden = false;
        this.disabled = false;
        this.value = '';
        this.checked = false;
        this.style = {};
        this.dataset = new Proxy({}, {
            set: (target, property, value) => {
                target[property] = String(value);
                this.attributes.set('data-' + dataAttribute(String(property)), String(value));
                return true;
            }
        });
        this.classList = new FakeClassList(this);
    }

    get id() {
        return this.attributes.get('id') || '';
    }

    set id(value) {
        this.setAttribute('id', value);
    }

    get className() {
        return [...this._classes].join(' ');
    }

    set className(value) {
        this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
    }

    get textContent() {
        if (this._textContent) return this._textContent;
        return this.children.map(child => child.textContent).join('');
    }

    set textContent(value) {
        this._textContent = String(value ?? '');
        this.children = [];
        this._innerHTML = '';
    }

    get innerHTML() {
        return this._innerHTML || this.textContent;
    }

    set innerHTML(value) {
        this._innerHTML = String(value ?? '');
        this._textContent = '';
        this.children = [];

        // The downloader creates preset cards with these two runtime labels.
        if (this._innerHTML.includes('preset-title')) {
            const title = new FakeElement('span', this.ownerDocument);
            title.className = 'preset-title';
            const subtitle = new FakeElement('span', this.ownerDocument);
            subtitle.className = 'preset-subtitle';
            this.append(title, subtitle);
        }
    }

    setAttribute(name, value) {
        const key = String(name);
        const stringValue = String(value);
        this.attributes.set(key, stringValue);
        if (key === 'class') this.className = stringValue;
        if (key.startsWith('data-')) this.dataset[dataProperty(key.slice(5))] = stringValue;
    }

    getAttribute(name) {
        return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(String(name));
    }

    addEventListener(type, handler) {
        const list = this.handlers.get(type) || [];
        list.push(handler);
        this.handlers.set(type, list);
    }

    dispatchEvent(event) {
        const type = typeof event === 'string' ? event : event.type;
        const payload = typeof event === 'string' ? { type, target: this, preventDefault() {} } : event;
        (this.handlers.get(type) || []).forEach(handler => handler(payload));
        return true;
    }

    click() {
        this.dispatchEvent({ type: 'click', target: this, preventDefault() {} });
    }

    focus() {
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
    }

    append(...nodes) {
        nodes.forEach(node => this.appendChild(node));
    }

    appendChild(node) {
        if (!node) return node;
        node.parentNode = this;
        this.children.push(node);
        return node;
    }

    replaceChildren(...nodes) {
        this.children = [];
        this._textContent = '';
        this._innerHTML = '';
        this.append(...nodes);
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = (element) => {
            if (matchesSelector(element, selector)) matches.push(element);
            element.children.forEach(visit);
        };
        this.children.forEach(visit);
        return matches;
    }
}

function matchesSelector(element, selector) {
    const value = String(selector).trim();
    if (value.startsWith('#')) return element.id === value.slice(1);
    if (value.startsWith('.')) return element.classList.contains(value.slice(1));
    if (value === '[data-landing-download-demo]') return element.getAttribute('data-landing-download-demo') !== null;
    if (value === '[data-demo-format]') return element.getAttribute('data-demo-format') !== null;
    if (value === '[data-i18n]') return element.getAttribute('data-i18n') !== null;
    if (value.startsWith('[') && value.endsWith(']')) {
        const attribute = value.slice(1, -1).split('=')[0].trim();
        return element.getAttribute(attribute) !== null;
    }
    return element.tagName.toLowerCase() === value.toLowerCase();
}

class FakeDocument extends FakeElement {
    constructor() {
        super('#document', null);
        this.ownerDocument = this;
        this.activeElement = null;
        this.documentElement = new FakeElement('html', this);
        this.body = new FakeElement('body', this);
        this.append(this.documentElement);
        this.documentElement.append(this.body);
    }

    createElement(tagName) {
        return new FakeElement(tagName, this);
    }

    getElementById(id) {
        return this.querySelector('#' + id);
    }
}

function addElement(document, parent, id, tagName = 'div', className = '') {
    const element = document.createElement(tagName);
    element.id = id;
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
}

module.exports = { FakeDocument, FakeElement, addElement };
