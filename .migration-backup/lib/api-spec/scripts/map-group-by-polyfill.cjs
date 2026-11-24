if (typeof Map.groupBy !== "function") {
  Object.defineProperty(Map, "groupBy", {
    configurable: true,
    writable: true,
    value(items, callback) {
      if (items == null || typeof callback !== "function") {
        throw new TypeError("Map.groupBy expects an iterable and a callback.");
      }

      const groups = new Map();
      let index = 0;
      for (const item of items) {
        const key = callback(item, index++);
        const group = groups.get(key);
        if (group) group.push(item);
        else groups.set(key, [item]);
      }
      return groups;
    },
  });
}
