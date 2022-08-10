/**
 * @param {Twinkly} twinkly
 * @return {{r: number, g: number, b: number}[][]}
 */
function generateTwinkleBlueWhite(twinkly) {
    return generateTwinkle(twinkly, {r: 0, g: 0, b: 255}, {r: 255, g: 255, b: 255});
}

/**
 * @param {Twinkly} twinkly
 * @return {{r: number, g: number, b: number}[][]}
 */
function generateTwinkleChristmasGreenRed(twinkly) {
    return generateTwinkle(twinkly, {r: 0, g: 135, b: 62}, {r: 195, g: 15, b: 22});
}

/**
 * Generate twinkle
 * @param {Twinkly} twinkly
 * @param {{r: number, g: number, b: number}} baseColor
 * @param {{r: number, g: number, b: number}} secondColor
 * @return {{r: number, g: number, b: number}[][]}
 */
function generateTwinkle(twinkly, baseColor, secondColor) {
    const frames = [];

    frames.push(twinkly.generateFrame(baseColor));

    const upIndex = [];
    const downIndex = [];

    for (let x = 0; x < twinkly.details.number_of_led; x++) {
        upIndex[x] = x;
        downIndex[x] = x;
    }

    const previous = twinkly.generateFrame(baseColor);

    function addTwinkleChange(arr, color) {
        const pickedIndexes = [];
        for (let x = 0; x < arr.length; x++) {
            let indexToPick = -1;
            do {
                indexToPick = Math.floor(Math.random() * arr.length);
            } while(pickedIndexes.includes(indexToPick));

            pickedIndexes.push(indexToPick);
            const nextIndex = arr[indexToPick];

            arr.splice(indexToPick, 1);
            previous[nextIndex] = color;
            frames.push(Object.assign([], previous));
        }
    }

    addTwinkleChange(upIndex, secondColor);

    frames.push(twinkly.generateFrame(secondColor));
    frames.push(twinkly.generateFrame(secondColor));
    frames.push(twinkly.generateFrame(secondColor));

    addTwinkleChange(downIndex, baseColor);

    return frames;
}

module.exports = {
    generateTwinkleBlueWhite,
    generateTwinkleChristmasGreenRed
};
