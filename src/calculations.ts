import { BigNumber } from "bignumber.js";
import {
    collateralToBase,
    collateralToNotional,
    collateralToUsd,
    notionalToCollateral,
    priceNotionalInCollateral,
    usdToCollateral,
} from "./marketPrice.ts";

BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

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
        const notionalLowCap = new BigNumber(args.deltaNeutralityFeeCap).negated().times(args.deltaNeutralityFeeSensitivity).toFixed();
        const notionalHighCap = new BigNumber(args.deltaNeutralityFeeCap).times(args.deltaNeutralityFeeSensitivity).toFixed();

        const deltaNotionalAtLowCap = BigNumber.min(
            new BigNumber(args.netNotional).plus(args.deltaNotional),
            notionalLowCap,
        ).minus(BigNumber.min(args.netNotional, notionalLowCap));
        const deltaNotionalAtHighCap = BigNumber.max(
            new BigNumber(args.netNotional).plus(args.deltaNotional),
            notionalHighCap,
        ).minus(BigNumber.max(args.netNotional, notionalHighCap));
        const deltaNotionalUncapped = new BigNumber(args.deltaNotional)
            .minus(deltaNotionalAtLowCap)
            .minus(deltaNotionalAtHighCap)
            .toFixed();

        const deltaNotionalFeeLow = new BigNumber(deltaNotionalAtLowCap).times(new BigNumber(args.deltaNeutralityFeeCap).negated())
            .toFixed();
        const deltaNotionalFeeHigh = new BigNumber(deltaNotionalAtHighCap).times(args.deltaNeutralityFeeCap).toFixed();
        const deltaNotionalFeeUncapped = new BigNumber(deltaNotionalUncapped)
            .times(deltaNotionalUncapped)
            .plus(
                new BigNumber("2")
                    .times(deltaNotionalUncapped)
                    .times(BigNumber.max(BigNumber.min(args.netNotional, notionalHighCap), notionalLowCap)),
            )
            .div(new BigNumber(args.deltaNeutralityFeeSensitivity).times("2"))
            .toFixed();

        return new BigNumber(deltaNotionalFeeLow)
            .plus(deltaNotionalFeeHigh)
            .plus(deltaNotionalFeeUncapped)
            .toFixed();
    }

    function calcInner(deltaNotional: string): string {
        const feeFund = new BigNumber(deltaNeutralityFeeFund).plus(fees).toFixed();

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
        if (new BigNumber(feeInCollateral).lt("0")) {
            const feeToBalanceInNotional = new BigNumber(
                calculateDNF({
                    deltaNeutralityFeeCap: args.deltaNeutralityFeeCap,
                    deltaNeutralityFeeSensitivity: args.deltaNeutralityFeeSensitivity,
                    netNotional,
                    deltaNotional: new BigNumber(netNotional).negated().toFixed(),
                }),
            )
                .abs()
                .toFixed();
            const feeToBalanceInCollateral = notionalToCollateral({
                marketType: args.marketType,
                notional: feeToBalanceInNotional,
                priceBase: args.priceBase,
            });

            const fundednessRatio = new BigNumber(feeToBalanceInCollateral).abs().lt(1e-6)
                ? "1"
                : new BigNumber(feeFund).div(feeToBalanceInCollateral).toFixed();

            fee = new BigNumber(feeInCollateral).times(BigNumber.min(fundednessRatio, "1")).toFixed();
        }

        netNotional = new BigNumber(netNotional).plus(deltaNotional).toFixed();
        fees = new BigNumber(fees).minus(fee).toFixed();

        return fees;
    }

    let netNotional: string = args.netNotional;
    let deltaNeutralityFeeFund: string = args.deltaNeutralityFeeFund;
    let fees: string = "0";

    const deltaNotional = new BigNumber(args.newNotional).minus(args.oldNotional).toFixed();
    const netNotionalAfter = new BigNumber(netNotional).plus(deltaNotional).toFixed();

    let amount: string;
    if (new BigNumber(netNotional).times(netNotionalAfter).lt("0")) {
        const deltaNotionalSecondCalc = new BigNumber(deltaNotional).plus(netNotional).toFixed();
        const part1 = calcInner(new BigNumber(netNotional).negated().toFixed());
        const part2 = calcInner(deltaNotionalSecondCalc);
        amount = new BigNumber(part1).plus(part2).toFixed();
    } else {
        amount = calcInner(deltaNotional);
    }

    if (new BigNumber(amount).gt("0")) {
        deltaNeutralityFeeFund = new BigNumber(deltaNeutralityFeeFund)
            .plus(
                new BigNumber(amount)
                    .times(
                        new BigNumber("1").minus(args.deltaNeutralityFeeTax),
                    ),
            )
            .toFixed();
    } else {
        deltaNeutralityFeeFund = new BigNumber(deltaNeutralityFeeFund).plus(amount).toFixed();
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
        tax: new BigNumber(detailsOnOpen.amount).plus(detailsOnClose.amount).toFixed(),
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
    const feeRate = new BigNumber(collateral).div(new BigNumber(args.newNotional).minus(args.oldNotional)).toFixed();
    const impactedPriceNotional = new BigNumber(priceNotional).times(new BigNumber("1").plus(feeRate)).toFixed();

    let impactedPriceBase: string;
    if (args.marketType === "collateral_is_base") {
        impactedPriceBase = new BigNumber("1").div(impactedPriceNotional).toFixed();
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
        notional: new BigNumber(args.oldNotional).abs().toFixed(),
        priceBase: args.priceBase,
    });
    const newNotionalInCollateral = notionalToCollateral({
        marketType: args.marketType,
        notional: new BigNumber(args.newNotional).abs().toFixed(),
        priceBase: args.priceBase,
    });

    let tradingFeeNotional: string;
    if (new BigNumber(newNotionalInCollateral).gt(oldNotionalInCollateral)) {
        tradingFeeNotional = new BigNumber(newNotionalInCollateral)
            .minus(oldNotionalInCollateral)
            .times(args.tradingFeeNotionalRate)
            .toFixed();
    } else {
        tradingFeeNotional = "0";
    }

    let tradingFeeCounterCollateral: string;
    if (new BigNumber(args.newCounterCollateral).gt(args.oldCounterCollateral)) {
        tradingFeeCounterCollateral = new BigNumber(args.newCounterCollateral)
            .minus(args.oldCounterCollateral)
            .times(args.counterSideCollateralFeeRate)
            .toFixed();
    } else {
        tradingFeeCounterCollateral = "0";
    }

    const tradingFee = collateralToUsd({
        collateral: new BigNumber(tradingFeeNotional).plus(tradingFeeCounterCollateral).toFixed(),
        priceUsd: args.priceUsd,
    });

    const borrowFee = collateralToUsd({
        collateral: BigNumber
            .max(args.newCounterCollateral, args.newMinCounterCollateral)
            .times(args.borrowFee)
            .div(365 * 24)
            .toFixed(),
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
    return new BigNumber((args.deferredExecutionItems + 5) / 10)
        .integerValue(BigNumber.ROUND_FLOOR)
        .times(args.crankFeeSurcharge)
        .plus(args.crankFeeCharged)
        .toFixed();
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
            collateral: new BigNumber(args.collateral)
                .times(args.leverage)
                .times(direction)
                .toFixed(),
            priceBase: args.priceBase,
        });
    } else {
        const notionalSizeCollateral = new BigNumber(args.collateral)
            .times(
                new BigNumber(direction)
                    .negated()
                    .times(args.leverage)
                    .plus(1),
            )
            .toFixed();
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
}): string {
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
    });

    const secondsInAYear = 365 * 24 * 60 * 60;
    const liquifundingDelayYears = new BigNumber(args.liquifundingDelaySeconds).div(secondsInAYear).toFixed();
    const borrowFeeMargin = new BigNumber(args.collateral)
        .plus(BigNumber.max(counterCollateral, minCounterCollateral))
        .times(args.borrowFeeRateCap)
        .times(liquifundingDelayYears)
        .toFixed();

    const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const maxPrice = args.direction === "long"
        ? new BigNumber(calculatedPriceNotionalInCollateral)
            .plus(new BigNumber(args.collateral).div(new BigNumber(notionalSize).abs()))
            .toFixed()
        : new BigNumber(calculatedPriceNotionalInCollateral)
            .plus(new BigNumber(args.collateral).div(new BigNumber(notionalSize).abs()))
            .toFixed();

    const fundingFeeMargin = new BigNumber(notionalSize)
        .abs()
        .times(maxPrice)
        .times(args.fundingFeeRateCap)
        .times(liquifundingDelayYears)
        .toFixed();

    const deltaNeutralityFeeMargin = new BigNumber(notionalSize)
        .abs()
        .times(maxPrice)
        .times(args.deltaNeutralityFeeCap)
        .toFixed();

    const crankFeeMargin = usdToCollateral({
        usd: args.crankFee,
        priceUsd: args.priceBase,
    });

    const exposureMargin = notionalToCollateral({
        marketType: args.marketType,
        notional: new BigNumber(notionalSize).abs().times(args.exposureMarginRatio).toFixed(),
        priceBase: args.priceBase,
    });

    const margin = new BigNumber(borrowFeeMargin)
        .plus(fundingFeeMargin)
        .plus(deltaNeutralityFeeMargin)
        .plus(crankFeeMargin)
        .plus(exposureMargin)
        .toFixed();

    const feesInCollateral = usdToCollateral({
        usd: new BigNumber(args.tradingFee).plus(args.deltaNeutralityFeeAsset).toFixed(),
        priceUsd: args.priceBase,
    });

    const liquidationPriceNotional = new BigNumber(calculatedPriceNotionalInCollateral)
        .minus(
            new BigNumber(args.collateral)
                .minus(feesInCollateral)
                .minus(margin)
                .div(notionalSize),
        )
        .toFixed();

    if (args.marketType === "collateral_is_base") {
        return new BigNumber("1").div(liquidationPriceNotional).toFixed();
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
}): string {
    const notionalSize = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const collateral = notionalToCollateral({
        marketType: args.marketType,
        notional: new BigNumber(notionalSize).abs().toFixed(),
        priceBase: args.priceBase,
    });
    return new BigNumber(collateral).div(args.maxLeverage).toFixed();
}

export function calculateCounterCollateral(args: {
    takeProfitPrice: string;
    direction: "long" | "short";
    collateral: string;
    leverage: string;
    maxLeverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
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
    });

    let counterCollateral: string;
    if (args.marketType === "collateral_is_quote") {
        const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
            marketType: args.marketType,
            priceBase: args.priceBase,
        });
        counterCollateral = new BigNumber(args.takeProfitPrice)
            .minus(calculatedPriceNotionalInCollateral)
            .times(notionalSize)
            .toFixed();
    } else {
        let takeProfitPriceNotional: string;
        if (new BigNumber(args.takeProfitPrice).lt(epsilon)) {
            takeProfitPriceNotional = "Infinity";
        } else {
            if (args.takeProfitPrice === "Infinity") {
                takeProfitPriceNotional = "0";
            } else {
                takeProfitPriceNotional = new BigNumber("1").div(args.takeProfitPrice).toFixed();
            }
        }

        const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
            marketType: args.marketType,
            priceBase: args.priceBase,
        });
        counterCollateral = new BigNumber(takeProfitPriceNotional)
            .minus(calculatedPriceNotionalInCollateral)
            .times(notionalSize)
            .toFixed();
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
    const maxGains = new BigNumber(args.maxGainsPercentage).div("100").toFixed();
    const takeProfitPriceChange = new BigNumber(direction)
        .times(maxGains)
        .div(args.leverage)
        .toFixed();

    const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const takeProfitPrice = args.marketType === "collateral_is_quote"
        ? new BigNumber(takeProfitPriceChange)
            .plus(1)
            .times(calculatedPriceNotionalInCollateral)
            .toFixed()
        : new BigNumber(takeProfitPriceChange)
            .plus(1)
            .div(calculatedPriceNotionalInCollateral)
            .toFixed();

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
        min: args.addPadding ? new BigNumber(args.priceBase).times(args.direction === "long" ? 1.001 : 0.999).toFixed() : args.priceBase,
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
        collateral: new BigNumber(args.collateral).times(args.leverage).abs().toFixed(),
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
        maxGains = new BigNumber(args.counterCollateral).div(args.activeCollateral).toFixed();
    } else {
        const takeProfitCollateral = new BigNumber(args.activeCollateral).plus(args.counterCollateral).toFixed();
        const calculatedPriceNotionalInCollateral = priceNotionalInCollateral({
            marketType: args.marketType,
            priceBase: args.priceBase,
        });
        const takeProfitPrice = new BigNumber(calculatedPriceNotionalInCollateral)
            .plus(new BigNumber(args.counterCollateral).div(args.notionalSize))
            .toFixed();
        const epsilon = 1e-7;

        if (new BigNumber(takeProfitPrice).lt(epsilon)) {
            maxGains = "Infinity";
        }

        const takeProfitInNotional = new BigNumber(takeProfitCollateral).div(takeProfitPrice).toFixed();
        const activeCollateralInNotional = collateralToNotional({
            marketType: args.marketType,
            collateral: args.activeCollateral,
            priceBase: args.priceBase,
        });
        maxGains = new BigNumber(takeProfitInNotional)
            .minus(activeCollateralInNotional)
            .div(activeCollateralInNotional)
            .toFixed();
    }

    return new BigNumber(maxGains).times("100").toFixed();
}

/**
 * @returns percentage
 */
export function calculateMaxGainsFromDependencies(args: {
    direction: "long" | "short";
    collateral: string;
    leverage: string;
    marketType: "collateral_is_quote" | "collateral_is_base";
    priceBase: string;
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
            ? new BigNumber(args.leverage).times("100").integerValue(BigNumber.ROUND_FLOOR).times(counterSideRatio).toFixed()
            : new BigNumber(args.leverage).times("100").integerValue(BigNumber.ROUND_FLOOR).times(buffer).toFixed();

        return {
            min: new BigNumber(args.leverage).div(args.maxLeverage).times("100").integerValue(BigNumber.ROUND_CEIL).toFixed(),
            max: maxMaxGains,
            end: undefined,
        };
    } else {
        const maxGainsSliderMin = new BigNumber("-1")
            .div(new BigNumber("1").minus(new BigNumber(direction).times(args.maxLeverage)))
            .times(args.leverage)
            .times(args.direction)
            .times("100")
            .integerValue(BigNumber.ROUND_CEIL)
            .toFixed();

        if (args.direction === "long") {
            const maxGainsSliderOneBeforeMax = new BigNumber("-1")
                .div(new BigNumber("1").minus(new BigNumber(direction).div(counterSideRatio)))
                .times(args.leverage)
                .times(args.direction)
                .times("100")
                .integerValue(BigNumber.ROUND_FLOOR)
                .toFixed();

            return {
                min: maxGainsSliderMin,
                max: maxGainsSliderOneBeforeMax,
                end: "Infinity",
            };
        } else {
            const takeProfitPriceChangeMax = -0.5;
            const maxGainsSliderMax = new BigNumber(takeProfitPriceChangeMax)
                .times(args.leverage)
                .times(args.direction)
                .times("100")
                .integerValue(BigNumber.ROUND_FLOOR)
                .toFixed();

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
        newNotionalSize = new BigNumber(args.notionalSize)
            .times(args.newLeverage)
            .div(args.leverage)
            .toFixed();
    } else {
        const direction = directionToNumber(args.direction);
        newNotionalSize = new BigNumber(args.notionalSize)
            .times(
                new BigNumber(args.newLeverage)
                    .times(-1)
                    .times(direction)
                    .plus(1),
            )
            .div(
                new BigNumber(args.leverage)
                    .times(-1)
                    .times(direction)
                    .plus(1),
            )
            .toFixed();
    }

    const newCounterCollateral = new BigNumber(args.counterCollateral)
        .times(newNotionalSize)
        .div(args.notionalSize)
        .toFixed();

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
    const newLeverageToNotional = new BigNumber(collateral).div(args.newCollateral).toFixed();

    const newLeverage = args.marketType === "collateral_is_quote"
        ? new BigNumber(newLeverageToNotional).times(directionToNumber(args.direction)).toFixed()
        : new BigNumber(newLeverageToNotional).times(-1).plus(1).times(directionToNumber(args.direction)).toFixed();

    return {
        leverage: new BigNumber(newLeverage).abs().toFixed(),
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
}): { collateral: string } {
    const newNotional = calculateNotionalSize({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
    });
    const deltaNotional = new BigNumber(newNotional).minus(args.oldNotional ?? "0").toFixed();

    const notionalLowCap = new BigNumber(args.deltaNeutralityFeeCap).negated().times(args.deltaNeutralityFeeSensitivity).toFixed();
    const notionalHighCap = new BigNumber(args.deltaNeutralityFeeCap).times(args.deltaNeutralityFeeSensitivity).toFixed();
    if (new BigNumber(args.netNotional).lt(notionalLowCap) && new BigNumber(deltaNotional).lt("0")) {
        return { collateral: "0" };
    }

    if (new BigNumber(args.netNotional).gt(notionalHighCap) && new BigNumber(deltaNotional).gt("0")) {
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
    const deltaNotional = new BigNumber(newNotional).minus(args.oldNotional ?? "0").toFixed();

    const notionalLowCap = new BigNumber(args.deltaNeutralityFeeCap).negated().times(args.deltaNeutralityFeeSensitivity).toFixed();
    const notionalHighCap = new BigNumber(args.deltaNeutralityFeeCap).times(args.deltaNeutralityFeeSensitivity).toFixed();

    let maxDeltaNotional: string;
    if (new BigNumber(deltaNotional).lt("0")) {
        maxDeltaNotional = new BigNumber(notionalLowCap).minus(args.netNotional).toFixed();
        if (maxDeltaNotional === "0") {
            return { collateral: "0", leverage: "0" };
        }
    } else {
        maxDeltaNotional = new BigNumber(notionalHighCap).minus(args.netNotional).toFixed();
        if (maxDeltaNotional === "0") {
            return { collateral: "0", leverage: "0" };
        }
    }

    const deltasRatio = new BigNumber(deltaNotional).div(maxDeltaNotional).toFixed();
    const newCollateral = notionalToCollateral({
        marketType: args.marketType,
        notional: newNotional,
        priceBase: args.priceBase,
    });
    const leverageToNotional = new BigNumber(newCollateral).div(args.collateral).toFixed();
    const maxLeverageToNotional = new BigNumber(leverageToNotional).div(deltasRatio).toFixed();

    const maxLeverage = args.marketType === "collateral_is_quote"
        ? new BigNumber(maxLeverageToNotional).abs().toFixed()
        : new BigNumber(direction).negated().times(maxLeverageToNotional).plus(direction).abs().toFixed();

    return {
        collateral: new BigNumber(args.collateral).div(deltasRatio).toFixed(),
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
        notional: new BigNumber(args.netNotional).abs().toFixed(),
        priceBase: args.priceBase,
    });
    const minUnlockedLiquidity = new BigNumber(netNotionalInCollateralAbs).div(args.carryLeverage).toFixed();
    const unlockedLiquidityUntilMin = BigNumber.max(new BigNumber(args.unlockedLiquidity).minus(minUnlockedLiquidity), "0").toFixed();
    return new BigNumber(unlockedLiquidityUntilMin).lte("0");
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
    const deltaNotional = new BigNumber(notionalSize).minus(oldNotionalAmount).toFixed();

    /**
     * net notional after position is opened
     */
    const netNotional = new BigNumber(args.netNotional).plus(deltaNotional).toFixed();

    /**
     * absolute value of the net notional after position is opened, in collateral
     * in other words - the distance from current net notional to zero (in collateral)
     */
    const netNotionalInCollateralAbs = notionalToCollateral({
        marketType: args.marketType,
        notional: new BigNumber(netNotional).abs().toFixed(),
        priceBase: args.priceBase,
    });

    /**
     * taking the above value, but converting it to the actual counter-collateral amount needed
     * using carryLeverage (not maximum possible counter leverage)
     * in other words, this is the actual counter-collateral amount needed to balance net-notional to zero
     */
    const minUnlockedLiquidity = new BigNumber(netNotionalInCollateralAbs).div(args.carryLeverage).toFixed();

    /**
     * calculate how much liquidity is available to be used for this position
     * i.e. given the actual amount of available liquidity
     * make sure there's enough left over after we deduct the amount needed to balance net-notional to zero
     */
    const unlockedLiquidityUntilMin = BigNumber.max(new BigNumber(args.unlockedLiquidity).minus(minUnlockedLiquidity), "0").toFixed();

    const oldCounterCollateral = args.oldCounterCollateralProp ?? "0";

    const newMaxGainsPercentage = calculateMaxGainsFromDependencies({
        direction: args.direction,
        collateral: args.collateral,
        leverage: args.leverage,
        marketType: args.marketType,
        priceBase: args.priceBase,
        takeProfitPrice: args.takeProfitPrice,
        maxLeverage: args.maxLeverage,
    });
    /**
     * calculateCounterCollateral assumes that the take profit price is the max gains price
     */
    const newMaxGainsAmount = new BigNumber(newMaxGainsPercentage).div("100").toFixed();

    const minMaxGainsPercentage = calculateMaxGainsRange({
        maxLeverage: args.maxLeverage,
        leverage: args.leverage,
        direction: args.direction,
        marketType: args.marketType,
    }).min;
    const minMaxGains = new BigNumber(minMaxGainsPercentage).div("100").toFixed();

    let maxGainsPrice: string;
    if (new BigNumber(newMaxGainsAmount).gt(minMaxGains)) {
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
    });

    const counterCollateral = notionalToCollateral({
        marketType: args.marketType,
        notional: new BigNumber(notionalSize).abs().toFixed(),
        priceBase: args.priceBase,
    });
    /**
     * now calculate the min counter-collateral the trader can lock up
     */
    const minCounterCollateral = new BigNumber(counterCollateral).div(args.maxLeverage).toFixed();

    /**
     * how much new counter collateral your position will be locking
     * (i.e. new target counter collateral minus what was already in the position)
     */
    const counterCollateralDelta = new BigNumber(newCounterCollateral).minus(oldCounterCollateral).toFixed();

    if (new BigNumber(counterCollateralDelta).lte("0")) {
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
    const minCounterCollateralDelta = new BigNumber(minCounterCollateral).minus(oldCounterCollateral).toFixed();

    /**
     * ratios between the delta and the maximum counter collateral available
     */
    const deltasRatio = new BigNumber(counterCollateralDelta).div(unlockedLiquidityUntilMin).toFixed();

    /**
     * TODO - the following may not ultimately be needed
     * we already know by here that the position is valid if deltasRatio is <= 1
     */
    const minDeltasRatio = new BigNumber(minCounterCollateralDelta).div(unlockedLiquidityUntilMin).toFixed();

    const leverageToNotional = new BigNumber(notionalToCollateral({
        marketType: args.marketType,
        notional: notionalSize,
        priceBase: args.priceBase,
    })).div(args.collateral).toFixed();

    const maxLeverageToNotional = new BigNumber(leverageToNotional).div(deltasRatio).toFixed();

    const maxLeveragePosition = args.marketType === "collateral_is_quote"
        ? new BigNumber(maxLeverageToNotional).abs().toFixed()
        : new BigNumber(direction).negated().times(maxLeverageToNotional).plus(direction).abs().toFixed();

    const maxMaxGains = calculateMaxGains({
        notionalSize,
        marketType: args.marketType,
        activeCollateral: args.collateral,
        counterCollateral: new BigNumber(unlockedLiquidityUntilMin).plus(oldCounterCollateral).toFixed(),
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
        collateral: new BigNumber(args.collateral).div(deltasRatio).toFixed(),
        collateralAtMinCounterCollateral: new BigNumber(minCounterCollateralDelta).lte("0")
            ? "Infinity"
            : new BigNumber(args.collateral).div(minDeltasRatio).toFixed(),
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
    const takeProfitPrice = new BigNumber(calculatedPriceNotionalInCollateral)
        .plus(args.counterCollateral)
        .div(notionalSize)
        .toFixed();

    const epsilon = 1e-7;

    if (new BigNumber(takeProfitPrice).lt(epsilon)) {
        if (args.marketType === "collateral_is_quote") {
            throw new Error("infinite max gains not allowed here");
        } else {
            return "Infinity";
        }
    } else {
        if (args.marketType === "collateral_is_quote") {
            return takeProfitPrice;
        } else {
            return new BigNumber("1").div(takeProfitPrice).toFixed();
        }
    }
}

function directionToNumber(direction: "long" | "short"): 1 | -1 {
    return direction === "long" ? 1 : -1;
}
