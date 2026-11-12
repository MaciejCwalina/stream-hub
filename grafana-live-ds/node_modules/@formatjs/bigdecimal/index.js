//#region packages/bigdecimal/index.ts
const DIV_PRECISION = 40;
function removeTrailingZeros(mantissa, exponent) {
	if (mantissa === 0n) return [0n, 0];
	while (mantissa % 10n === 0n) {
		mantissa /= 10n;
		exponent++;
	}
	return [mantissa, exponent];
}
function bigintAbs(n) {
	return n < 0n ? -n : n;
}
function digitCount(n) {
	if (n === 0n) return 1;
	if (n < 0n) n = -n;
	let count = 0;
	const big15 = 1000000000000000n;
	while (n >= big15) {
		n /= big15;
		count += 15;
	}
	let r = Number(n);
	while (r >= 1) {
		r /= 10;
		count++;
	}
	return count;
}
const TEN_BIGINT = 10n;
function bigintPow10(n) {
	if (n <= 0) return 1n;
	let result = 1n;
	let base = TEN_BIGINT;
	let exp = n;
	while (exp > 0) {
		if (exp & 1) result *= base;
		base *= base;
		exp >>= 1;
	}
	return result;
}
function parseDecimalString(s) {
	s = s.trim();
	if (s === "NaN") return {
		mantissa: 0n,
		exponent: 0,
		special: 1,
		negativeZero: false
	};
	if (s === "Infinity" || s === "+Infinity") return {
		mantissa: 0n,
		exponent: 0,
		special: 2,
		negativeZero: false
	};
	if (s === "-Infinity") return {
		mantissa: 0n,
		exponent: 0,
		special: 3,
		negativeZero: false
	};
	let negative = false;
	let idx = 0;
	if (s[idx] === "-") {
		negative = true;
		idx++;
	} else if (s[idx] === "+") idx++;
	let eIdx = s.indexOf("e", idx);
	if (eIdx === -1) eIdx = s.indexOf("E", idx);
	let sciExp = 0;
	let numPart;
	if (eIdx !== -1) {
		sciExp = parseInt(s.substring(eIdx + 1), 10);
		numPart = s.substring(idx, eIdx);
	} else numPart = s.substring(idx);
	const dotIdx = numPart.indexOf(".");
	let intPart;
	let fracPart;
	if (dotIdx !== -1) {
		intPart = numPart.substring(0, dotIdx);
		fracPart = numPart.substring(dotIdx + 1);
	} else {
		intPart = numPart;
		fracPart = "";
	}
	const combined = intPart + fracPart;
	const exponent = sciExp - fracPart.length;
	if (combined === "" || combined === "0" || /^0+$/.test(combined)) return {
		mantissa: 0n,
		exponent: 0,
		special: 0,
		negativeZero: negative
	};
	let mantissa = BigInt(combined);
	if (negative) mantissa = -mantissa;
	const [normMantissa, normExponent] = removeTrailingZeros(mantissa, exponent);
	return {
		mantissa: normMantissa,
		exponent: normExponent,
		special: 0,
		negativeZero: false
	};
}
var BigDecimal = class BigDecimal {
	constructor(value) {
		if (typeof value === "bigint") {
			const [m, e] = removeTrailingZeros(value, 0);
			this._mantissa = m;
			this._exponent = e;
			this._special = 0;
			this._negativeZero = false;
			return;
		}
		if (typeof value === "number") {
			if (Number.isNaN(value)) {
				this._mantissa = 0n;
				this._exponent = 0;
				this._special = 1;
				this._negativeZero = false;
				return;
			}
			if (value === Infinity) {
				this._mantissa = 0n;
				this._exponent = 0;
				this._special = 2;
				this._negativeZero = false;
				return;
			}
			if (value === -Infinity) {
				this._mantissa = 0n;
				this._exponent = 0;
				this._special = 3;
				this._negativeZero = false;
				return;
			}
			if (value === 0) {
				this._mantissa = 0n;
				this._exponent = 0;
				this._special = 0;
				this._negativeZero = Object.is(value, -0);
				return;
			}
			value = String(value);
		}
		const parsed = parseDecimalString(value);
		this._mantissa = parsed.mantissa;
		this._exponent = parsed.exponent;
		this._special = parsed.special;
		this._negativeZero = parsed.negativeZero;
	}
	static _create(mantissa, exponent, special, negativeZero) {
		const bd = Object.create(BigDecimal.prototype);
		bd._mantissa = mantissa;
		bd._exponent = exponent;
		bd._special = special;
		bd._negativeZero = negativeZero;
		return bd;
	}
	static _coerce(v) {
		return v instanceof BigDecimal ? v : new BigDecimal(v);
	}
	times(y) {
		const other = BigDecimal._coerce(y);
		if (this._special || other._special) return this._specialArith(other, "times");
		if (this._mantissa === 0n || other._mantissa === 0n) {
			const negZero = this._isSignNegative() ? !other._isSignNegative() : other._isSignNegative();
			return BigDecimal._create(0n, 0, 0, negZero);
		}
		const [nm, ne] = removeTrailingZeros(this._mantissa * other._mantissa, this._exponent + other._exponent);
		return BigDecimal._create(nm, ne, 0, false);
	}
	div(y) {
		const other = BigDecimal._coerce(y);
		if (this._special || other._special) return this._specialArith(other, "div");
		if (other._mantissa === 0n) {
			if (this._mantissa === 0n) return BigDecimal._create(0n, 0, 1, false);
			const neg = this._isSignNegative() !== other._isSignNegative();
			return BigDecimal._create(0n, 0, neg ? 3 : 2, false);
		}
		if (this._mantissa === 0n) {
			const negZero = this._isSignNegative() !== other._isSignNegative();
			return BigDecimal._create(0n, 0, 0, negZero);
		}
		const [nm, ne] = removeTrailingZeros(this._mantissa * bigintPow10(DIV_PRECISION) / other._mantissa, this._exponent - other._exponent - DIV_PRECISION);
		return BigDecimal._create(nm, ne, 0, false);
	}
	plus(y) {
		const other = BigDecimal._coerce(y);
		if (this._special || other._special) return this._specialArith(other, "plus");
		if (this._mantissa === 0n && other._mantissa === 0n) {
			const negZero = this._negativeZero && other._negativeZero;
			return BigDecimal._create(0n, 0, 0, negZero);
		}
		if (this._mantissa === 0n) return other;
		if (other._mantissa === 0n) return this;
		let m1 = this._mantissa;
		let m2 = other._mantissa;
		const e1 = this._exponent;
		const e2 = other._exponent;
		const minE = Math.min(e1, e2);
		if (e1 > minE) m1 *= bigintPow10(e1 - minE);
		if (e2 > minE) m2 *= bigintPow10(e2 - minE);
		const sum = m1 + m2;
		if (sum === 0n) return BigDecimal._create(0n, 0, 0, false);
		const [nm, ne] = removeTrailingZeros(sum, minE);
		return BigDecimal._create(nm, ne, 0, false);
	}
	minus(y) {
		return this.plus(BigDecimal._coerce(y).negated());
	}
	mod(y) {
		const other = BigDecimal._coerce(y);
		if (this._special || other._special) {
			if (this._special === 1 || other._special === 1) return BigDecimal._create(0n, 0, 1, false);
			if (this._special === 2 || this._special === 3) return BigDecimal._create(0n, 0, 1, false);
			if (other._special === 2 || other._special === 3) return this;
		}
		if (other._mantissa === 0n) return BigDecimal._create(0n, 0, 1, false);
		if (this._mantissa === 0n) return this;
		let m1 = this._mantissa;
		let m2 = other._mantissa;
		const e1 = this._exponent;
		const e2 = other._exponent;
		const minE = Math.min(e1, e2);
		if (e1 > minE) m1 *= bigintPow10(e1 - minE);
		if (e2 > minE) m2 *= bigintPow10(e2 - minE);
		const remainder = m1 % m2;
		if (remainder === 0n) return BigDecimal._create(0n, 0, 0, false);
		const [nm, ne] = removeTrailingZeros(remainder, minE);
		return BigDecimal._create(nm, ne, 0, false);
	}
	abs() {
		if (this._special === 1) return this;
		if (this._special === 3) return BigDecimal._create(0n, 0, 2, false);
		return BigDecimal._create(bigintAbs(this._mantissa), this._exponent, this._special, false);
	}
	negated() {
		if (this._special === 1) return this;
		if (this._special === 2) return BigDecimal._create(0n, 0, 3, false);
		if (this._special === 3) return BigDecimal._create(0n, 0, 2, false);
		if (this._mantissa === 0n) return BigDecimal._create(0n, 0, 0, !this._negativeZero);
		return BigDecimal._create(-this._mantissa, this._exponent, 0, false);
	}
	pow(n) {
		if (this._special === 1) return this;
		if (n === 0) return new BigDecimal(1);
		if (n < 0) return new BigDecimal(1).div(this.pow(-n));
		if (this._special === 2) return this;
		if (this._special === 3) return n % 2 === 0 ? BigDecimal._create(0n, 0, 2, false) : this;
		if (this._mantissa === 0n) return new BigDecimal(0);
		const [nm, ne] = removeTrailingZeros(this._mantissa ** BigInt(n), this._exponent * n);
		return BigDecimal._create(nm, ne, 0, false);
	}
	floor() {
		if (this._special !== 0) return this;
		if (this._mantissa === 0n) return this;
		if (this._exponent >= 0) return this;
		const divisor = bigintPow10(-this._exponent);
		const m = this._mantissa;
		let q = m / divisor;
		if (m < 0n && m % divisor !== 0n) q -= 1n;
		if (q === 0n) {
			const negZero = this._mantissa < 0n;
			return BigDecimal._create(0n, 0, 0, negZero);
		}
		const [nm, ne] = removeTrailingZeros(q, 0);
		return BigDecimal._create(nm, ne, 0, false);
	}
	ceil() {
		if (this._special !== 0) return this;
		if (this._mantissa === 0n) return this;
		if (this._exponent >= 0) return this;
		const divisor = bigintPow10(-this._exponent);
		const m = this._mantissa;
		let q = m / divisor;
		if (m > 0n && m % divisor !== 0n) q += 1n;
		if (q === 0n) return BigDecimal._create(0n, 0, 0, false);
		const [nm, ne] = removeTrailingZeros(q, 0);
		return BigDecimal._create(nm, ne, 0, false);
	}
	log(base) {
		if (this._special === 1) return this;
		if (this._special === 3) return BigDecimal._create(0n, 0, 1, false);
		if (this._special === 2) return BigDecimal._create(0n, 0, 2, false);
		if (this._mantissa < 0n) return BigDecimal._create(0n, 0, 1, false);
		if (this._mantissa === 0n) return BigDecimal._create(0n, 0, 3, false);
		if (base === 10) return this._log10();
		const log10x = this._log10();
		const log10b = new BigDecimal(Math.log10(base));
		return log10x.div(log10b);
	}
	_log10() {
		const absMantissa = bigintAbs(this._mantissa);
		const digits = digitCount(absMantissa);
		let log10Mantissa;
		if (digits <= 15) log10Mantissa = Math.log10(Number(absMantissa));
		else {
			const shift = digits - 17;
			const leading = absMantissa / bigintPow10(shift);
			log10Mantissa = Math.log10(Number(leading)) + shift;
		}
		return new BigDecimal(log10Mantissa + this._exponent);
	}
	eq(y) {
		const other = BigDecimal._coerce(y);
		if (this._special === 1 || other._special === 1) return false;
		if (this._special !== other._special) return false;
		if (this._special !== 0) return true;
		if (this._mantissa === 0n && other._mantissa === 0n) return true;
		return this._mantissa === other._mantissa && this._exponent === other._exponent;
	}
	_compareTo(other) {
		if (this._special === 1 || other._special === 1) return NaN;
		if (this._special === 2) return other._special === 2 ? 0 : 1;
		if (this._special === 3) return other._special === 3 ? 0 : -1;
		if (other._special === 2) return -1;
		if (other._special === 3) return 1;
		const thisZero = this._mantissa === 0n;
		const otherZero = other._mantissa === 0n;
		if (thisZero && otherZero) return 0;
		if (thisZero) return other._mantissa > 0n ? -1 : 1;
		if (otherZero) return this._mantissa > 0n ? 1 : -1;
		const thisNeg = this._mantissa < 0n;
		if (thisNeg !== other._mantissa < 0n) return thisNeg ? -1 : 1;
		let m1 = this._mantissa;
		let m2 = other._mantissa;
		const e1 = this._exponent;
		const e2 = other._exponent;
		const minE = Math.min(e1, e2);
		if (e1 > minE) m1 *= bigintPow10(e1 - minE);
		if (e2 > minE) m2 *= bigintPow10(e2 - minE);
		if (m1 < m2) return -1;
		if (m1 > m2) return 1;
		return 0;
	}
	lessThan(y) {
		return this._compareTo(BigDecimal._coerce(y)) === -1;
	}
	greaterThan(y) {
		return this._compareTo(BigDecimal._coerce(y)) === 1;
	}
	lessThanOrEqualTo(y) {
		const c = this._compareTo(BigDecimal._coerce(y));
		return c === 0 || c === -1;
	}
	greaterThanOrEqualTo(y) {
		const c = this._compareTo(BigDecimal._coerce(y));
		return c === 0 || c === 1;
	}
	isZero() {
		return this._special === 0 && this._mantissa === 0n;
	}
	isNaN() {
		return this._special === 1;
	}
	isFinite() {
		return this._special === 0;
	}
	isNegative() {
		if (this._special === 1) return false;
		if (this._special === 3) return true;
		if (this._special === 2) return false;
		if (this._mantissa === 0n) return this._negativeZero;
		return this._mantissa < 0n;
	}
	isPositive() {
		if (this._special === 1) return false;
		if (this._special === 2) return true;
		if (this._special === 3) return false;
		if (this._mantissa === 0n) return !this._negativeZero;
		return this._mantissa > 0n;
	}
	isInteger() {
		if (this._special !== 0) return false;
		if (this._mantissa === 0n) return true;
		return this._exponent >= 0;
	}
	toJSON() {
		return this.toString();
	}
	toNumber() {
		if (this._special === 1) return NaN;
		if (this._special === 2) return Infinity;
		if (this._special === 3) return -Infinity;
		if (this._mantissa === 0n) return this._negativeZero ? -0 : 0;
		return Number(this.toString());
	}
	toString() {
		if (this._special === 1) return "NaN";
		if (this._special === 2) return "Infinity";
		if (this._special === 3) return "-Infinity";
		if (this._mantissa === 0n) return "0";
		const negative = this._mantissa < 0n;
		const absStr = bigintAbs(this._mantissa).toString();
		const prefix = negative ? "-" : "";
		if (this._exponent === 0) return prefix + absStr;
		if (this._exponent > 0) return prefix + absStr + "0".repeat(this._exponent);
		const decimalPlaces = -this._exponent;
		if (decimalPlaces < absStr.length) {
			const intPart = absStr.slice(0, absStr.length - decimalPlaces);
			const fracPart = absStr.slice(absStr.length - decimalPlaces);
			return prefix + intPart + "." + fracPart;
		} else {
			const leadingZeros = decimalPlaces - absStr.length;
			return prefix + "0." + "0".repeat(leadingZeros) + absStr;
		}
	}
	static pow(base, exp) {
		const n = typeof exp === "number" ? exp : exp.toNumber();
		if (typeof base === "number" && base === 10) return BigDecimal._create(1n, n, 0, false);
		return (base instanceof BigDecimal ? base : new BigDecimal(base)).pow(n);
	}
	static set(_config) {}
	_isSignNegative() {
		if (this._special === 3) return true;
		if (this._mantissa < 0n) return true;
		if (this._mantissa === 0n) return this._negativeZero;
		return false;
	}
	_specialArith(other, op) {
		const a = this._special;
		const b = other._special;
		if (a === 1 || b === 1) return BigDecimal._create(0n, 0, 1, false);
		const aNeg = this._isSignNegative();
		const bNeg = other._isSignNegative();
		const aInf = a === 2 || a === 3;
		const bInf = b === 2 || b === 3;
		if (op === "times") {
			if (aInf || bInf) {
				if (aInf && other._mantissa === 0n && !bInf || bInf && this._mantissa === 0n && !aInf) return BigDecimal._create(0n, 0, 1, false);
				const neg = aNeg !== bNeg;
				return BigDecimal._create(0n, 0, neg ? 3 : 2, false);
			}
		}
		if (op === "div") {
			if (aInf && bInf) return BigDecimal._create(0n, 0, 1, false);
			if (aInf) {
				const neg = aNeg !== bNeg;
				return BigDecimal._create(0n, 0, neg ? 3 : 2, false);
			}
			if (bInf) {
				const negZero = aNeg !== bNeg;
				return BigDecimal._create(0n, 0, 0, negZero);
			}
		}
		if (op === "plus") {
			if (aInf && bInf) {
				if (aNeg !== bNeg) return BigDecimal._create(0n, 0, 1, false);
				return this;
			}
			if (aInf) return this;
			if (bInf) return other;
		}
		return BigDecimal._create(0n, 0, 1, false);
	}
};
//#endregion
export { BigDecimal, BigDecimal as Decimal, BigDecimal as default };

//# sourceMappingURL=index.js.map