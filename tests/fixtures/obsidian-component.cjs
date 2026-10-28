// Minimal Obsidian lifecycle used by dashboard listener tests.
class Component {
    load() { for (const child of this.children || []) child.load(); }
    unload() {
        for (const child of this.children || []) child.unload();
        for (const cleanup of this.cleanups || []) cleanup();
        this.children = [];
        this.cleanups = [];
    }
    addChild(child) {
        (this.children ||= []).push(child);
        child.load();
        return child;
    }
    removeChild(child) {
        this.children = (this.children || []).filter(entry => entry !== child);
        child.unload();
        return child;
    }
    register(cleanup) { (this.cleanups ||= []).push(cleanup); }
    registerDomEvent(target, type, callback, options) {
        target.addEventListener(type, callback, options);
        this.register(() => target.removeEventListener(type, callback, options));
    }
}
module.exports = { Component };
