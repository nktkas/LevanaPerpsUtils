import { Decimal } from "decimal.js";
import {
    collateralToBase,
    collateralToNotional,
    collateralToUsd,
    notionalToCollateral,
    priceNotionalInCollateral,
    usdToCollateral,
} from "./marketPrice.ts";

export function calculateDnfDetails(args: {
    oldNotional: string;
    newNotional: string;
    deltaNeutralityFeeFund: string;
    netNotional: string;
    deltaNeutralityFeeCap: string;
    deltaNeutralityFeeSensitivity: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    deltaNeutralityFeeTax: string;
}): {
    amount: string;
    newDnfFund: string;
    newNetNotional: string;
} {
    function calculateDNF(args: {
        deltaNeutralityFeeCap: string;
        deltaNeutralityFeeSensitivity: string;
        netNotional: string;
        deltaNotional: string;
    }): string {
        const notionalLowCap = new Decimal(args.deltaNeutralityFeeCap).negated().times(args.deltaNeutralityFeeSensitivity).toString();
        const notionalHighCap = new Decimal(args.deltaNeutralityFeeCap).times(args.deltaNeutralityFeeSensitivity).toString();

        const deltaNotionalAtLowCap = Decimal.min(
            new Decimal(args.netNotional).plus(args.deltaNotional),
            notionalLowCap,
        ).minus(Decimal.min(args.netNotional, notionalLowCap));
        const deltaNotionalAtHighCap = Decimal.max(
            new Decimal(args.netNotional).plus(args.deltaNotional),
            notionalHighCap,
        ).minus(Decimal.max(args.netNotional, notionalHighCap));
        const deltaNotionalUncapped = new Decimal(args.deltaNotional)
            .minus(deltaNotionalAtLowCap)
            .minus(deltaNotionalAtHighCap)
            .toString();

        const deltaNotionalFeeLow = new Decimal(deltaNotionalAtLowCap).times(new Decimal(args.deltaNeutralityFeeCap).negated()).toString();
        const deltaNotionalFeeHigh = new Decimal(deltaNotionalAtHighCap).times(args.deltaNeutralityFeeCap).toString();
        const deltaNotionalFeeUncapped = new Decimal(deltaNotionalUncapped)
            .times(deltaNotionalUncapped)
            .plus(
                new Decimal("2")
                    .times(deltaNotionalUncapped)
                    .times(Decimal.max(Decimal.min(args.netNotional, notionalHighCap), notionalLowCap)),
            )
            .div(new Decimal(args.deltaNeutralityFeeSensitivity).times("2"))
            .toString();

        return new Decimal(deltaNotionalFeeLow)
            .plus(deltaNotionalFeeHigh)
            .plus(deltaNotionalFeeUncapped)
            .toString();
    }

    function calcInner(deltaNotional: string): string {
        const feeFund = new Decimal(deltaNeutralityFeeFund).plus(fees).toString();

        const feeInNotional = calculateDNF({
            deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
            deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
            netNotional,
            deltaNotional,
        });
        const feeInCollateral = notionalToCollateral({
            marketType: args.marketType,
            notional: feeInNotional,
            priceBase: args.priceBase,
        });

        let fee: string = feeInCollateral;
        if (new Decimal(feeInCollateral).lessThan("0")) {
            const feeToBalanceInNotional = Decimal.abs(
                calculateDNF({
                    deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
                    deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
                    netNotional,
                    deltaNotional: new Decimal(netNotional).negated().toString(),
                }),
            ).toString();
            const feeToBalanceInCollateral = notionalToCollateral({
                marketType: args.marketType,
                notional: feeToBalanceInNotional,
                priceBase: args.priceBase,
            });

            const fundednessRatio = Decimal.abs(feeToBalanceInCollateral).lessThan(1e-6)
                ? "1"
                : new Decimal(feeFund).div(feeToBalanceInCollateral).toString();

            fee = new Decimal(feeInCollateral).times(Decimal.min(fundednessRatio, "1")).toString();
        }

        netNotional = new Decimal(netNotional).plus(deltaNotional).toString();
        fees = new Decimal(fees).minus(fee).toString();

        return fees;
    }

    let netNotional: string = args.netNotional;
    let deltaNeutralityFeeFund: string = args.deltaNeutralityFeeFund;
    let fees: string = "0";

    const deltaNotional = new Decimal(args.newNotional).minus(args.oldNotional).toString();
    const netNotionalAfter = new Decimal(netNotional).plus(deltaNotional).toString();

    let amount: string;
    if (new Decimal(netNotional).times(netNotionalAfter).lessThan("0")) {
        const deltaNotionalSecondCalc = new Decimal(deltaNotional).plus(netNotional).toString();
        const part1 = calcInner(new Decimal(netNotional).negated().toString());
        const part2 = calcInner(deltaNotionalSecondCalc);
        amount = new Decimal(part1).plus(part2).toString();
    } else {
        amount = calcInner(deltaNotional);
    }

    if (new Decimal(amount).greaterThan("0")) {
        deltaNeutralityFeeFund = new Decimal(deltaNeutralityFeeFund)
            .plus(
                new Decimal(amount)
                    .times(
                        new Decimal("1").minus(args.deltaNeutralityFeeTax),
                    ),
            )
            .toString();
    } else {
        deltaNeutralityFeeFund = new Decimal(deltaNeutralityFeeFund).plus(amount).toString();
    }

    return {
        amount: collateralToUsd({ collateral: amount, priceUsd: args.priceBase }),
        newDnfFund: deltaNeutralityFeeFund,
        newNetNotional: netNotional,
    };
}

export function calculateDeltaNeutralityFee(args: {
    oldNotional: string;
    newNotional: string;
    deltaNeutralityFeeFund: string;
    netNotional: string;
    deltaNeutralityFeeCap: string;
    deltaNeutralityFeeSensitivity: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    deltaNeutralityFeeTax: string;
}): string {
    const details = calculateDnfDetails({
        oldNotional: args.oldNotional,
        newNotional: args.newNotional,
        deltaNeutralityFeeFund: args.deltaNeutralityFeeFund,
        netNotional: args.netNotional,
        deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
        deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
        marketType: args.marketType,
        priceBase: args.priceBase,
        deltaNeutralityFeeTax: args.deltaNeutralityFeeTax,
    });
    return details.amount;
}

export function calculateDeltaNeutralityTax(args: {
    oldNotional: string;
    newNotional: string;
    deltaNeutralityFeeFund: string;
    netNotional: string;
    deltaNeutralityFeeCap: string;
    deltaNeutralityFeeSensitivity: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    deltaNeutralityFeeTax: string;
}): {
    dnfOnOpen: string;
    tax: string;
} {
    const detailsOnOpen = calculateDnfDetails({
        oldNotional: args.oldNotional,
        newNotional: args.newNotional,
        deltaNeutralityFeeFund: args.deltaNeutralityFeeFund,
        netNotional: args.netNotional,
        deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
        deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
        marketType: args.marketType,
        priceBase: args.priceBase,
        deltaNeutralityFeeTax: args.deltaNeutralityFeeTax,
    });
    const detailsOnClose = calculateDnfDetails({
        oldNotional: args.newNotional,
        newNotional: args.oldNotional,
        deltaNeutralityFeeFund: detailsOnOpen.newDnfFund,
        netNotional: detailsOnOpen.newNetNotional,
        deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
        deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
        marketType: args.marketType,
        priceBase: args.priceBase,
        deltaNeutralityFeeTax: args.deltaNeutralityFeeTax,
    });
    return {
        dnfOnOpen: detailsOnOpen.amount,
        tax: new Decimal(detailsOnOpen.amount).plus(detailsOnClose.amount).toString(),
    };
}

export function calculatePriceBaseDNFImpacted(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    dnf: string;
    priceUsd: string;
    newNotional: string;
    oldNotional: string;
}): string {
    const priceNotional = priceNotionalInCollateral({ marketType: args.marketType, priceBase: args.priceBase });
    const collateral = usdToCollateral({ usd: args.dnf, priceUsd: args.priceUsd });
    const feeRate = new Decimal(collateral).div(new Decimal(args.newNotional).minus(args.oldNotional)).toString();
    const impactedPriceNotional = new Decimal(priceNotional).times(new Decimal("1").plus(feeRate)).toString();

    let impactedPriceBase: string;
    if (args.marketType === "collateral_is_base") {
        impactedPriceBase = new Decimal("1").div(impactedPriceNotional).toString();
    } else {
        impactedPriceBase = impactedPriceNotional;
    }

    return impactedPriceBase;
}

export function calculatePriceBaseDNFImpactedFromDeps(args: {
    deltaNeutralityFeeCap: string;
    deltaNeutralityFeeFund: string;
    deltaNeutralityFeeSensitivity: string;
    deltaNeutralityFeeTax: string;
    netNotional: string;
    newNotional: string;
    oldNotional: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    priceUsd: string;
}): string {
    const deltaNeutralityFeeAsset = calculateDeltaNeutralityFee({
        oldNotional: args.oldNotional,
        newNotional: args.newNotional,
        deltaNeutralityFeeFund: args.deltaNeutralityFeeFund,
        netNotional: args.netNotional,
        deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
        deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
        marketType: args.marketType,
        priceBase: args.priceBase,
        deltaNeutralityFeeTax: args.deltaNeutralityFeeTax,
    });
    const priceBaseImpacted = calculatePriceBaseDNFImpacted({
        marketType: args.marketType,
        priceBase: args.priceBase,
        dnf: deltaNeutralityFeeAsset,
        priceUsd: args.priceUsd,
        newNotional: args.newNotional,
        oldNotional: args.oldNotional,
    });
    return priceBaseImpacted;
}

export function calculateFees(args: {
    marketType: "collateral_is_quote" | "collateral_is_base";
    oldNotional: string;
    newNotional: string;
    oldCounterCollateral: string;
    newCounterCollateral: string;
    tradingFeeNotionalRate: string;
    counterSideCollateralFeeRate: string;
    newMinCounterCollateral: string;
    priceBase: string;
    priceUsd: string;
    borrowFee: string;
}): {
    tradingFee: string;
    /** Borrow fee is annualized, and locked profit is in collateral. Convert to USD and express hourly. */
    borrowFee: string;
} {
    const oldNotionalInCollateral = notionalToCollateral({
        marketType: args.marketType,
        notional: Decimal.abs(args.oldNotional).toString(),
        priceBase: args.priceBase,
    });
    const newNotionalInCollateral = notionalToCollateral({
        marketType: args.marketType,
        notional: Decimal.abs(args.newNotional).toString(),
        priceBase: args.priceBase,
    });

    let tradingFeeNotional: string;
    if (new Decimal(newNotionalInCollateral).greaterThan(oldNotionalInCollateral)) {
        tradingFeeNotional = new Decimal(newNotionalInCollateral)
            .minus(oldNotionalInCollateral)
            .times(args.tradingFeeNotionalRate)
            .toString();
    } else {
        tradingFeeNotional = "0";
    }

    let tradingFeeCounterCollateral: string;
    if (new Decimal(args.newCounterCollateral).greaterThan(args.oldCounterCollateral)) {
        tradingFeeCounterCollateral = new Decimal(args.newCounterCollateral)
            .minus(args.oldCounterCollateral)
            .times(args.counterSideCollateralFeeRate)
            .toString();
    } else {
        tradingFeeCounterCollateral = "0";
    }

    const tradingFee = collateralToUsd({
        collateral: new Decimal(tradingFeeNotional).plus(tradingFeeCounterCollateral).toString(),
        priceUsd: args.priceUsd,
    });

    const borrowFee = collateralToUsd({
        collateral: Decimal
            .max(args.newCounterCollateral, args.newMinCounterCollateral)
            .times(args.borrowFee)
            .div(365 * 24)
            .toString(),
        priceUsd: args.priceUsd,
    });

    return {
        tradingFee,
        borrowFee,
    };
}

export function calculateDeferredExecutionCrankFee(args: {
    deferredExecutionItems: number;
    crankFeeSurcharge: string;
    crankFeeCharged: string;
}): string {
    return new Decimal((args.deferredExecutionItems + 5) / 10)
        .floor()
        .times(args.crankFeeSurcharge)
        .plus(args.crankFeeCharged)
        .toString();
}

export function calculateNotionalSize(args: {
    direction: "long" | "short";
    collateral: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
}): string {
    const direction = directionToNumber(args.direction);

    if (args.marketType === "collateral_is_quote") {
        return collateralToNotional({
            marketType: args.marketType,
            collateral: new Decimal(args.collateral)
                .times(args.leverage)
                .times(direction)
                .toString(),
            priceBase: args.priceBase,
        });
    } else {
        const notionalSizeCollateral = new Decimal(args.collateral)
            .times(
                new Decimal(direction)
                    .negated()
                    .times(args.leverage)
                    .plus(1),
            )
            .toString();
        return collateralToNotional({
            marketType: args.marketType,
            collateral: notionalSizeCollateral,
            priceBase: args.priceBase,
        });
    }
}

export function calculatePositionStats(args: {
    leverage: string;
    tradingFeeNotionalRate: string;
    counterSideCollateralFeeRate: string;
    deltaNeutralityFeeCap: string;
    deltaNeutralityFeeFund: string;
    deltaNeutralityFeeSensitivity: string;
    deltaNeutralityFeeTax: string;
    netNotional: string;
    takeProfitPrice: string;
    collateral: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    direction: "long" | "short";
    maxLeverage: string;
    borrowFee: string;
    borrowFeeRateCap: string;
    priceUsd: string;
    crankFee: string;
    exposureMarginRatio: string;
    fundingFeeRateCap: string;
    liquifundingDelaySeconds: string;
}): {
    collateral: string;
    positionSize: string;
    takeProfitPrice: string;
    lockedProfit: string;
    liquidation: string;
    tradingFee: string;
    borrowFee: string;
    deltaNeutralityTax: string;
} {
    const positionSize = calculatePositionSize({
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });

    const notionalSize = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const { counterCollateral, minCounterCollateral } = calculateCounterCollateral({
        takeProfitPrice: args.takeProfitPrice,
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        maxLeverage: args.maxLeverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
        allowNegative: false,
    });

    const { tradingFee, borrowFee } = calculateFees({
        newCounterCollateral: counterCollateral,
        newMinCounterCollateral: minCounterCollateral,
        newNotional: notionalSize,
        oldCounterCollateral: "0",
        oldNotional: "0",
        marketType: args.marketType,
        priceBase: args.priceBase,
        priceUsd: args.priceUsd,
        tradingFeeNotionalRate: args.tradingFeeNotionalRate,
        counterSideCollateralFeeRate: args.counterSideCollateralFeeRate,
        borrowFee: args.borrowFee,
    });

    const deltaNeutralityFeeAsset = calculateDeltaNeutralityFee({
        oldNotional: "0",
        newNotional: notionalSize,
        deltaNeutralityFeeFund: args.deltaNeutralityFeeFund,
        netNotional: args.netNotional,
        deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
        deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
        marketType: args.marketType,
        priceBase: args.priceBase,
        deltaNeutralityFeeTax: args.deltaNeutralityFeeTax,
    });

    const liquidation = calculateLiquidationPrice({
        collateral: args.collateral,
        borrowFeeRateCap: args.borrowFeeRateCap,
        crankFee: args.crankFee,
        deltaNeutralityFeeAsset,
        deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
        direction: args.direction,
        exposureMarginRatio: args.exposureMarginRatio,
        fundingFeeRateCap: args.fundingFeeRateCap,
        leverage: args.leverage,
        liquifundingDelaySeconds: args.liquifundingDelaySeconds,
        marketType: args.marketType,
        maxLeverage: args.maxLeverage,
        priceBase: args.priceBase,
        takeProfitPrice: args.takeProfitPrice,
        tradingFee,
    });

    const deltaNeutralityTax = calculateDeltaNeutralityTax({
        oldNotional: "0",
        newNotional: notionalSize,
        deltaNeutralityFeeFund: args.deltaNeutralityFeeFund,
        netNotional: args.netNotional,
        deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
        deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
        marketType: args.marketType,
        priceBase: args.priceBase,
        deltaNeutralityFeeTax: args.deltaNeutralityFeeTax,
    }).tax;

    return {
        collateral: args.collateral,
        positionSize,
        takeProfitPrice: args.takeProfitPrice,
        lockedProfit: counterCollateral,
        liquidation,
        tradingFee,
        borrowFee,
        deltaNeutralityTax,
    };
}

export function calculateLiquidationPrice(args: {
    liquifundingDelaySeconds: string;
    borrowFeeRateCap: string;
    fundingFeeRateCap: string;
    deltaNeutralityFeeCap: string;
    crankFee: string;
    tradingFee: string;
    deltaNeutralityFeeAsset: string;
    exposureMarginRatio: string;
    collateral: string;
    direction: "long" | "short";
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    takeProfitPrice: string;
    maxLeverage: string;
}) {
    const notionalSize = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const { counterCollateral, minCounterCollateral } = calculateCounterCollateral({
        takeProfitPrice: args.takeProfitPrice,
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        maxLeverage: args.maxLeverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
        allowNegative: false,
    });

    const secondsInAYear = 365 * 24 * 60 * 60;
    const liquifundingDelayYears = new Decimal(args.liquifundingDelaySeconds).div(secondsInAYear).toString();
    const borrowFeeMargin = new Decimal(args.collateral)
        .plus(Decimal.max(counterCollateral, minCounterCollateral))
        .times(args.borrowFeeRateCap)
        .times(liquifundingDelayYears)
        .toString();

    const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const maxPrice = args.direction === "long"
        ? new Decimal(calculatedPriceNotionalInCollateral)
            .plus(new Decimal(args.collateral).div(Decimal.abs(notionalSize)))
            .toString()
        : new Decimal(calculatedPriceNotionalInCollateral)
            .plus(new Decimal(args.collateral).div(Decimal.abs(notionalSize)))
            .toString();

    const fundingFeeMargin = new Decimal(notionalSize)
        .abs()
        .times(maxPrice)
        .times(args.fundingFeeRateCap)
        .times(liquifundingDelayYears)
        .toString();

    const deltaNeutralityFeeMargin = new Decimal(notionalSize)
        .abs()
        .times(maxPrice)
        .times(args.deltaNeutralityFeeCap)
        .toString();

    const crankFeeMargin = usdToCollateral({
        usd: args.crankFee,
        priceUsd: args.priceBase,
    });

    const exposureMargin = notionalToCollateral({
        marketType: args.marketType,
        notional: new Decimal(notionalSize).abs().times(args.exposureMarginRatio).toString(),
        priceBase: args.priceBase,
    });

    const margin = new Decimal(borrowFeeMargin)
        .plus(fundingFeeMargin)
        .plus(deltaNeutralityFeeMargin)
        .plus(crankFeeMargin)
        .plus(exposureMargin)
        .toString();

    const feesInCollateral = usdToCollateral({
        usd: new Decimal(args.tradingFee).plus(args.deltaNeutralityFeeAsset).toString(),
        priceUsd: args.priceBase,
    });

    const liquidationPriceNotional = new Decimal(calculatedPriceNotionalInCollateral)
        .minus(
            new Decimal(args.collateral)
                .minus(feesInCollateral)
                .minus(margin)
                .div(notionalSize),
        )
        .toString();

    if (args.marketType === "collateral_is_base") {
        return new Decimal("1").div(liquidationPriceNotional).toString();
    } else {
        return liquidationPriceNotional;
    }
}

/**
 * Calculate the minimum counter-collateral which can actually be locked up
 * if the actual counter-collateral that will be "take-profitted" is less than this,
 * then borrow fees are calculated based on this value
 */
export function calculateMinimumCounterCollateral(args: {
    direction: "long" | "short";
    collateral: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    maxLeverage: string;
    allowNegative: boolean;
}): string {
    const notionalSize = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    if (args.allowNegative) {
        // A comparable value resembling +Inf
        return "1000000000000000";
    } else {
        const collateral = notionalToCollateral({
            marketType: args.marketType,
            notional: Decimal.abs(notionalSize).toString(),
            priceBase: args.priceBase,
        });
        return new Decimal(collateral).div(args.maxLeverage).toString();
    }
}

export function calculateCounterCollateral(args: {
    takeProfitPrice: string;
    direction: "long" | "short";
    collateral: string;
    leverage: string;
    maxLeverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    allowNegative: boolean;
}): {
    counterCollateral: string;
    /** see calculateMinimumCounterCollateral() for details on this value */
    minCounterCollateral: string;
} {
    const epsilon = 1e-7;
    const notionalSize = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });

    const minCounterCollateral = calculateMinimumCounterCollateral({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
        maxLeverage: args.maxLeverage,
        allowNegative: args.allowNegative,
    });

    let counterCollateral: string;
    if (args.marketType === "collateral_is_quote") {
        const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
            marketType: args.marketType,
            priceBase: args.priceBase,
        });
        counterCollateral = new Decimal(args.takeProfitPrice)
            .minus(calculatedPriceNotionalInCollateral)
            .times(notionalSize)
            .toString();
    } else {
        let takeProfitPriceNotional: string;
        if (new Decimal(args.takeProfitPrice).lessThan(epsilon)) {
            takeProfitPriceNotional = "Infinity";
        } else {
            if (args.takeProfitPrice === "Infinity") {
                takeProfitPriceNotional = "0";
            } else {
                takeProfitPriceNotional = new Decimal("1").div(args.takeProfitPrice).toString();
            }
        }

        const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
            marketType: args.marketType,
            priceBase: args.priceBase,
        });
        counterCollateral = new Decimal(takeProfitPriceNotional)
            .minus(calculatedPriceNotionalInCollateral)
            .times(notionalSize)
            .toString();
    }

    return {
        counterCollateral,
        minCounterCollateral,
    };
}

export function calculateTakeProfitPrice(args: {
    direction: "long" | "short";
    maxGainsPercentage: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
}): {
    takeProfitPrice: string;
    takeProfitPriceChange: string;
} {
    const direction = directionToNumber(args.direction);
    const maxGains = new Decimal(args.maxGainsPercentage).div(100).toString();
    const takeProfitPriceChange = new Decimal(direction)
        .times(maxGains)
        .div(args.leverage)
        .toString();

    const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const takeProfitPrice = args.marketType === "collateral_is_quote"
        ? new Decimal(takeProfitPriceChange)
            .plus(1)
            .times(calculatedPriceNotionalInCollateral)
            .toString()
        : new Decimal(takeProfitPriceChange)
            .plus(1)
            .div(calculatedPriceNotionalInCollateral)
            .toString();

    return {
        takeProfitPrice,
        takeProfitPriceChange,
    };
}

export function calculateTakeProfitPriceRange(args: {
    direction: "long" | "short";
    maxLeverage: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    addPadding: boolean;
}): { min: string; max: string } {
    const maxGainsRange = calculateMaxGainsRange({
        maxLeverage: args.maxLeverage,
        leverage: args.leverage,
        direction: args.direction,
        marketType: args.marketType,
    });

    const takeProfitForMaxMaxGains = calculateTakeProfitPrice({
        direction: args.direction,
        maxGainsPercentage: maxGainsRange.max,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    }).takeProfitPrice;

    return {
        min: args.addPadding ? new Decimal(args.priceBase).times(args.direction === "long" ? 1.001 : 0.999).toString() : args.priceBase,
        max: takeProfitForMaxMaxGains,
    };
}

export function calculatePositionSize(args: {
    collateral: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
}): string {
    return collateralToBase({
        marketType: args.marketType,
        collateral: new Decimal(args.collateral).times(args.leverage).abs().toString(),
        priceBase: args.priceBase,
    });
}

/**
 * @returns percentage
 */
export function calculateMaxGains(args: {
    notionalSize: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    activeCollateral: string;
    counterCollateral: string;
    priceBase: string;
}): string {
    let maxGains: string;

    if (args.marketType === "collateral_is_quote") {
        maxGains = new Decimal(args.counterCollateral).div(args.activeCollateral).toString();
    } else {
        const takeProfitCollateral = new Decimal(args.activeCollateral).plus(args.counterCollateral).toString();
        const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
            marketType: args.marketType,
            priceBase: args.priceBase,
        });
        const takeProfitPrice = new Decimal(calculatedPriceNotionalInCollateral)
            .plus(new Decimal(args.counterCollateral).div(args.notionalSize))
            .toString();
        const epsilon = 1e-7;

        if (new Decimal(takeProfitPrice).lessThan(epsilon)) {
            maxGains = "Infinity";
        }

        const takeProfitInNotional = new Decimal(takeProfitCollateral).div(takeProfitPrice).toString();
        const activeCollateralInNotional = collateralToNotional({
            marketType: args.marketType,
            collateral: args.activeCollateral,
            priceBase: args.priceBase,
        });
        maxGains = new Decimal(takeProfitInNotional)
            .minus(activeCollateralInNotional)
            .div(activeCollateralInNotional)
            .toString();
    }

    return new Decimal(maxGains).times("100").toString();
}

export function calculateMaxGainsFromDependencies(args: {
    direction: "long" | "short";
    collateral: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    allowNegative: boolean;
    takeProfitPrice: string;
    maxLeverage: string;
}): string {
    const notionalSize = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const { counterCollateral } = calculateCounterCollateral({
        takeProfitPrice: args.takeProfitPrice,
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        maxLeverage: args.maxLeverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
        allowNegative: args.allowNegative,
    });
    return calculateMaxGains({
        activeCollateral: args.collateral,
        counterCollateral,
        marketType: args.marketType,
        notionalSize,
        priceBase: args.priceBase,
    });
}

/**
 * @returns percentage
 */
export function calculateMaxGainsRange(args: {
    maxLeverage: string;
    leverage: string;
    direction: "long" | "short";
    marketType: "collateral_is_quote" | "collateral_is_base";
}): {
    /** percentage */
    min: string;
    /** percentage */
    max: string;
    /** percentage */
    end: string | undefined;
} {
    const direction = directionToNumber(args.direction);

    const counterSideRatio = 9 / 10;

    /**
     * PERP-2971 For some of the fields below, we add a small buffer of 1%
     * to prevent small price deltas from resulting in a too-low countercollateral
     * leverage.
     */
    const buffer = 0.99;

    if (args.marketType === "collateral_is_quote") {
        const maxMaxGains = args.direction === "short"
            ? new Decimal(args.leverage).times("100").floor().times(counterSideRatio).toString()
            : new Decimal(args.leverage).times("100").floor().times(buffer).toString();

        return {
            min: new Decimal(args.leverage).div(args.maxLeverage).times("100").ceil().toString(),
            max: maxMaxGains,
            end: undefined,
        };
    } else {
        const maxGainsSliderMin = new Decimal("-1")
            .div(new Decimal("1").minus(new Decimal(direction).times(args.maxLeverage)))
            .times(args.leverage)
            .times(args.direction)
            .times("100")
            .ceil()
            .toString();

        if (args.direction === "long") {
            const maxGainsSliderOneBeforeMax = new Decimal("-1")
                .div(new Decimal("1").minus(new Decimal(direction).div(counterSideRatio)))
                .times(args.leverage)
                .times(args.direction)
                .times("100")
                .floor()
                .toString();

            return {
                min: maxGainsSliderMin,
                max: maxGainsSliderOneBeforeMax,
                end: "Infinity",
            };
        } else {
            const takeProfitPriceChangeMax = -0.5;
            const maxGainsSliderMax = new Decimal(takeProfitPriceChangeMax)
                .times(args.leverage)
                .times(args.direction)
                .times("100")
                .floor()
                .toString();

            return {
                min: maxGainsSliderMin,
                max: maxGainsSliderMax,
                end: undefined,
            };
        }
    }
}

export function calculateUpdateLeverage(args: {
    counterCollateral: string;
    leverage: string;
    newLeverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    notionalSize: string;
    direction: "long" | "short";
}): {
    counterCollateral: string;
    notionalSize: string;
} {
    let newNotionalSize: string;
    if (args.marketType === "collateral_is_quote") {
        newNotionalSize = new Decimal(args.notionalSize)
            .times(args.newLeverage)
            .div(args.leverage)
            .toString();
    } else {
        const direction = directionToNumber(args.direction);
        newNotionalSize = new Decimal(args.notionalSize)
            .times(
                new Decimal(args.newLeverage)
                    .times(-1)
                    .times(direction)
                    .plus(1),
            )
            .div(
                new Decimal(args.leverage)
                    .times(-1)
                    .times(direction)
                    .plus(1),
            )
            .toString();
    }

    const newCounterCollateral = new Decimal(args.counterCollateral)
        .times(newNotionalSize)
        .div(args.notionalSize)
        .toString();

    return {
        counterCollateral: newCounterCollateral,
        notionalSize: newNotionalSize,
    };
}

export function calculateCollateralImpactLeverage(args: {
    newCollateral: string;
    notionalSize: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    direction: "long" | "short";
    priceBase: string;
}): {
    leverage: string;
    leverageSigned: string;
} {
    const collateral = notionalToCollateral({
        marketType: args.marketType,
        notional: args.notionalSize,
        priceBase: args.priceBase,
    });
    const newLeverageToNotional = new Decimal(collateral).div(args.newCollateral).toString();

    const newLeverage = args.marketType === "collateral_is_quote"
        ? new Decimal(newLeverageToNotional).times(directionToNumber(args.direction)).toString()
        : new Decimal(newLeverageToNotional).times(-1).plus(1).times(directionToNumber(args.direction)).toString();

    return {
        leverage: Decimal.abs(newLeverage).toString(),
        leverageSigned: newLeverage,
    };
}

export function calculateDnfCapOutOfBalance(args: {
    netNotional: string;
    deltaNeutralityFeeCap: string;
    deltaNeutralityFeeSensitivity: string;
    direction: "long" | "short";
    collateral: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    oldNotional?: string;
}) {
    const newNotional = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const deltaNotional = new Decimal(newNotional).minus(args.oldNotional ?? "0").toString();

    const notionalLowCap = new Decimal(args.deltaNeutralityFeeCap).negated().times(args.deltaNeutralityFeeSensitivity).toString();
    const notionalHighCap = new Decimal(args.deltaNeutralityFeeCap).times(args.deltaNeutralityFeeSensitivity).toString();
    if (new Decimal(args.netNotional).lessThan(notionalLowCap) && new Decimal(deltaNotional).lessThan("0")) {
        return { collateral: "0" };
    }

    if (new Decimal(args.netNotional).greaterThan(notionalHighCap) && new Decimal(deltaNotional).greaterThan("0")) {
        return { collateral: "0" };
    }

    return {
        collateral: "Infinity",
    };
}

export function calculateDnfCapWithinBalance(args: {
    netNotional: string;
    deltaNeutralityFeeCap: string;
    deltaNeutralityFeeSensitivity: string;
    collateral: string;
    direction: "long" | "short";
    oldNotional?: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
}): { collateral: string; leverage: string } {
    const direction = directionToNumber(args.direction);

    const newNotional = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const deltaNotional = new Decimal(newNotional).minus(args.oldNotional ?? "0").toString();

    const notionalLowCap = new Decimal(args.deltaNeutralityFeeCap).negated().times(args.deltaNeutralityFeeSensitivity).toString();
    const notionalHighCap = new Decimal(args.deltaNeutralityFeeCap).times(args.deltaNeutralityFeeSensitivity).toString();

    let maxDeltaNotional: string;
    if (new Decimal(deltaNotional).lessThan("0")) {
        maxDeltaNotional = new Decimal(notionalLowCap).minus(args.netNotional).toString();
        if (maxDeltaNotional === "0") {
            return { collateral: "0", leverage: "0" };
        }
    } else {
        maxDeltaNotional = new Decimal(notionalHighCap).minus(args.netNotional).toString();
        if (maxDeltaNotional === "0") {
            return { collateral: "0", leverage: "0" };
        }
    }

    const deltasRatio = new Decimal(deltaNotional).div(maxDeltaNotional).toString();
    const newCollateral = notionalToCollateral({
        marketType: args.marketType,
        notional: newNotional,
        priceBase: args.priceBase,
    });
    const leverageToNotional = new Decimal(newCollateral).div(args.collateral).toString();
    const maxLeverageToNotional = new Decimal(leverageToNotional).div(deltasRatio).toString();

    const maxLeverage = args.marketType === "collateral_is_quote"
        ? Decimal.abs(maxLeverageToNotional).toString()
        : new Decimal(direction).negated().times(maxLeverageToNotional).plus(direction).abs().toString();

    return {
        collateral: new Decimal(args.collateral).div(deltasRatio).toString(),
        leverage: maxLeverage,
    };
}

export function noLiquidityInDirection(args: {
    carryLeverage: string;
    netNotional: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    unlockedLiquidity: string;
}): boolean {
    const netNotionalInCollateralAbs = notionalToCollateral({
        marketType: args.marketType,
        notional: Decimal.abs(args.netNotional).toString(),
        priceBase: args.priceBase,
    });
    const minUnlockedLiquidity = new Decimal(netNotionalInCollateralAbs).div(args.carryLeverage).toString();
    const unlockedLiquidityUntilMin = Decimal.max(new Decimal(args.unlockedLiquidity).minus(minUnlockedLiquidity), "0").toString();
    return new Decimal(unlockedLiquidityUntilMin).lessThanOrEqualTo("0");
}

/**
 * calculate the amount of counter-collateral needed to bring net notional to zero
 * using carry leverage (not maximum possible counter leverage)
 */
export function calculateUnlockedLiquidity(args: {
    collateral: string;
    direction: "long" | "short";
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
    carryLeverage: string;
    oldNotional?: string;
    netNotional: string;
    unlockedLiquidity: string;
    oldCounterCollateralProp: string;
    takeProfitPrice: string;
    maxLeverage: string;
}): {
    newCounterCollateral: string;
    minUnlockedLiquidity: string;
    collateral: string;
    collateralAtMinCounterCollateral: string;
    leverage: string;
    maxGains: string;
} {
    const direction = directionToNumber(args.direction);

    const notionalSize = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const oldNotionalAmount = args.oldNotional ?? "0";
    const deltaNotional = new Decimal(notionalSize).minus(oldNotionalAmount).toString();

    /**
     * net notional after position is opened
     */
    const netNotional = new Decimal(args.netNotional).plus(deltaNotional).toString();

    /**
     * absolute value of the net notional after position is opened, in collateral
     * in other words - the distance from current net notional to zero (in collateral)
     */
    const netNotionalInCollateralAbs = notionalToCollateral({
        marketType: args.marketType,
        notional: Decimal.abs(netNotional).toString(),
        priceBase: args.priceBase,
    });

    /**
     * taking the above value, but converting it to the actual counter-collateral amount needed
     * using carryLeverage (not maximum possible counter leverage)
     * in other words, this is the actual counter-collateral amount needed to balance net-notional to zero
     */
    const minUnlockedLiquidity = new Decimal(netNotionalInCollateralAbs).div(args.carryLeverage).toString();

    /**
     * calculate how much liquidity is available to be used for this position
     * i.e. given the actual amount of available liquidity
     * make sure there's enough left over after we deduct the amount needed to balance net-notional to zero
     */
    const unlockedLiquidityUntilMin = Decimal.max(new Decimal(args.unlockedLiquidity).minus(minUnlockedLiquidity), "0").toString();

    const oldCounterCollateral = args.oldCounterCollateralProp ?? "0";

    const newMaxGainsPercentage = calculateMaxGainsFromDependencies({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
        allowNegative: false,
        takeProfitPrice: args.takeProfitPrice,
        maxLeverage: args.maxLeverage,
    });
    /**
     * calculateCounterCollateral assumes that the take profit price is the max gains price
     */
    const newMaxGainsAmount = new Decimal(newMaxGainsPercentage).div("100").toString();

    const minMaxGainsPercentage = calculateMaxGainsRange({
        maxLeverage: args.maxLeverage,
        leverage: args.leverage,
        direction: args.direction,
        marketType: args.marketType,
    }).min;
    const minMaxGains = new Decimal(minMaxGainsPercentage).div("100").toString();

    let maxGainsPrice: string;
    if (new Decimal(newMaxGainsAmount).greaterThan(minMaxGains)) {
        maxGainsPrice = args.takeProfitPrice;
    } else {
        maxGainsPrice = calculateTakeProfitPrice({
            direction: args.direction,
            maxGainsPercentage: minMaxGainsPercentage,
            leverage: args.leverage,
            marketType: args.marketType,
            priceBase: args.priceBase,
        }).takeProfitPrice;
    }

    const { counterCollateral: newCounterCollateral } = calculateCounterCollateral({
        takeProfitPrice: maxGainsPrice,
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        maxLeverage: args.maxLeverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
        allowNegative: false,
    });

    const counterCollateral = notionalToCollateral({
        marketType: args.marketType,
        notional: Decimal.abs(notionalSize).toString(),
        priceBase: args.priceBase,
    });
    /**
     * now calculate the min counter-collateral the trader can lock up
     */
    const minCounterCollateral = new Decimal(counterCollateral).div(args.maxLeverage).toString();

    /**
     * how much new counter collateral your position will be locking
     * (i.e. new target counter collateral minus what was already in the position)
     */
    const counterCollateralDelta = new Decimal(newCounterCollateral).minus(oldCounterCollateral).toString();

    if (new Decimal(counterCollateralDelta).lessThanOrEqualTo("0")) {
        return {
            newCounterCollateral,
            minUnlockedLiquidity,
            collateral: "Infinity",
            collateralAtMinCounterCollateral: "Infinity",
            leverage: "Infinity",
            maxGains: "Infinity",
        };
    }

    /**
     * just the delta between the old counter collateral and minimum counter collateral the trader can lock up
     */
    const minCounterCollateralDelta = new Decimal(minCounterCollateral).minus(oldCounterCollateral).toString();

    /**
     * ratios between the delta and the maximum counter collateral available
     */
    const deltasRatio = new Decimal(counterCollateralDelta).div(unlockedLiquidityUntilMin).toString();

    /**
     * TODO - the following may not ultimately be needed
     * we already know by here that the position is valid if deltasRatio is <= 1
     */
    const minDeltasRatio = new Decimal(minCounterCollateralDelta).div(unlockedLiquidityUntilMin).toString();

    const leverageToNotional = new Decimal(notionalToCollateral({
        marketType: args.marketType,
        notional: notionalSize,
        priceBase: args.priceBase,
    })).div(args.collateral).toString();

    const maxLeverageToNotional = new Decimal(leverageToNotional).div(deltasRatio).toString();

    const maxLeveragePosition = args.marketType === "collateral_is_quote"
        ? Decimal.abs(maxLeverageToNotional).toString()
        : new Decimal(direction).negated().times(maxLeverageToNotional).plus(direction).abs().toString();

    const maxMaxGains = calculateMaxGains({
        notionalSize,
        marketType: args.marketType,
        activeCollateral: args.collateral,
        counterCollateral: new Decimal(unlockedLiquidityUntilMin).plus(oldCounterCollateral).toString(),
        priceBase: args.priceBase,
    });

    /**
     * if newCounterCollateral (i.e. the amount we want to lock up) plus unlockedLiquidityUntilMin (i.e. the amount we can lock up)
     * is less than positionStatsProps.unlockedLiquidity (the actual available liquidity in the pool), then we can open the position
     * but a more direct comparison is just to compare the returned collateral value to the trader's desired collateral
     */
    return {
        newCounterCollateral,
        minUnlockedLiquidity,
        collateral: new Decimal(args.collateral).div(deltasRatio).toString(),
        collateralAtMinCounterCollateral: new Decimal(minCounterCollateralDelta).lessThanOrEqualTo("0")
            ? "Infinity"
            : new Decimal(args.collateral).div(minDeltasRatio).toString(),
        /** maximum valid leverage for your position */
        leverage: maxLeveragePosition,
        maxGains: maxMaxGains,
    };
}

export function calculateTakeProfitFromCounterCollateral(args: {
    direction: "long" | "short";
    leverage: string;
    counterCollateral: string;
    collateral: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
}): string {
    const notionalSize = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });

    const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const takeProfitPrice = new Decimal(calculatedPriceNotionalInCollateral)
        .plus(args.counterCollateral)
        .div(notionalSize)
        .toString();

    const epsilon = 1e-7;

    if (new Decimal(takeProfitPrice).lessThan(epsilon)) {
        if (args.marketType === "collateral_is_quote") {
            throw new Error("infinite max gains not allowed here");
        } else {
            return "Infinity";
        }
    } else {
        if (args.marketType === "collateral_is_quote") {
            return takeProfitPrice;
        } else {
            return new Decimal("1").div(takeProfitPrice).toString();
        }
    }
}

function directionToNumber(direction: "long" | "short"): 1 | -1 {
    return direction === "long" ? 1 : -1;
}
