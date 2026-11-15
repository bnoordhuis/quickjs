(function (s, nums, sel) {
    function chk(c, m) { if (!c) throw "ORACLE date: " + m; }
    function valid(t, what) { chk(Number.isNaN(t) || (Number.isInteger(t) && Math.abs(t) <= 8.64e15), what + ": time value out of range: " + t); }
    function exercise(d, what) {
        var t = d.getTime();
        valid(t, what);
        var getters = ["getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes", "getSeconds", "getMilliseconds",
                       "getUTCFullYear", "getUTCMonth", "getUTCDate", "getUTCDay", "getUTCHours", "getUTCMinutes", "getUTCSeconds",
                       "getUTCMilliseconds", "getTimezoneOffset", "getYear", "valueOf"];
        for (var i = 0; i < getters.length; i++) {
            var g = d[getters[i]]();
            chk(Number.isNaN(g) === Number.isNaN(t) && (Number.isNaN(g) || Number.isInteger(g)), what + ": " + getters[i] + "() = " + g + " for time " + t);
        }
        d.toString(); d.toDateString(); d.toTimeString(); d.toUTCString(); d.toLocaleString(); d.toLocaleDateString(); d.toLocaleTimeString(); d.toJSON();
        if (Number.isNaN(t)) return;
        // Formatting and parsing must agree (TZ is UTC).
        var iso = d.toISOString();
        chk(Date.parse(iso) === t, what + ": toISOString round trip: " + iso + " for " + t);
        var sec = t - ((t % 1000) + 1000) % 1000;
        chk(Date.parse(d.toString()) === sec, what + ": toString round trip: " + d.toString() + " for " + t);
        chk(Date.parse(d.toUTCString()) === sec, what + ": toUTCString round trip: " + d.toUTCString() + " for " + t);
        chk(d.getUTCDay() === ((Math.floor(t / 864e5) + 4) % 7 + 7) % 7, what + ": weekday wrong for " + t);
    }

    if (s !== undefined) {
        var t = Date.parse(s);
        // Date.parse can return a value just outside the valid range when a UTC
        // offset pushes it over (findings.md N5); the constructor clips it to NaN.
        if (Math.abs(t) > 8.64e15) return;
        var d = new Date(s);
        chk(Object.is(d.getTime(), t), "Date.parse and new Date(string) disagree for " + JSON.stringify(s));
        exercise(d, "parse " + JSON.stringify(s));
        return;
    }

    var d = new Date(...nums);
    exercise(d, "new Date(" + nums + ")");
    var u = Date.UTC(...nums);
    valid(u, "Date.UTC(" + nums + ")");
    if (nums.length >= 2) chk(Object.is(u, d.getTime()), "Date.UTC and the constructor disagree for " + nums + " (TZ is UTC)");
    var setters = ["setTime", "setMilliseconds", "setUTCMilliseconds", "setSeconds", "setUTCSeconds", "setMinutes", "setUTCMinutes",
                   "setHours", "setUTCHours", "setDate", "setUTCDate", "setMonth", "setUTCMonth", "setFullYear", "setUTCFullYear", "setYear"];
    var name = setters[sel % setters.length];
    for (var k = 1; k <= Math.min(4, nums.length); k++) {
        var x = new Date(nums[0]);
        var r = x[name](...nums.slice(nums.length - k));
        chk(Object.is(r, x.getTime()), name + " return value differs from the stored time");
        exercise(x, name + "(" + nums.slice(nums.length - k) + ") on " + nums[0]);
    }
})
