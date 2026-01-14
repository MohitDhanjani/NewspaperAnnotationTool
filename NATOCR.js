"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const amazon_textract_response_parser_1 = require("amazon-textract-response-parser");
const rbush_1 = __importDefault(require("rbush"));
const turf_1 = __importDefault(require("@turf/turf"));
var ocrBridge = document.getElementById('ocrBridge');
ocrBridge.addEventListener('click', DoNewspaperAnalysis);
var generateTextBridge = document.getElementById('generateTextBridge');
generateTextBridge.addEventListener('click', processText);
var ocrMenuItem = document.getElementById('ocrMenuItem');
var formerItemString = ocrMenuItem.innerText;
var OCRStates = {};
// Add this helper at the top or bottom of your file to calculate Bounding Boxes for VIA regions
function getRegionBoundingBox(shapeAttributes) {
    if (shapeAttributes.name === 'polygon') {
        const xs = shapeAttributes.all_points_x;
        const ys = shapeAttributes.all_points_y;
        return {
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys)
        };
    }
    else if (shapeAttributes.name === 'rect') {
        return {
            minX: shapeAttributes.x,
            minY: shapeAttributes.y,
            maxX: shapeAttributes.x + shapeAttributes.width,
            maxY: shapeAttributes.y + shapeAttributes.height
        };
    }
    return null;
}
function DoNewspaperAnalysis() {
    // ocrMenuItem.innerHTML = 'Processing...';
    // ocrBridge.disabled = true;
    const lamUrl = _via_settings.nat.lambda_url;
    const currentImageID = _via_image_id;
    if (lamUrl == '') {
        show_message('AWS Lambda Function URL missing. Please add in project settings.');
        ocrBridge.disabled = false;
        ocrMenuItem.innerHTML = formerItemString;
    }
    else {
        if (currentImageID in OCRStates) {
            show_message('Using cached file.');
            processTextractResponse(currentImageID);
        }
        else {
            show_message('Connecting to AWS Textract.', -1);
            (0, axios_1.default)({
                method: "POST",
                url: lamUrl,
                headers: {
                    'x-nat-apikey': _via_settings.nat.lambda_api_key
                },
                data: _via_img_fileref[currentImageID]
            }).then((response) => {
                show_message('Response received from AWS Textract.', -1);
                const layoutsFromTextract = new amazon_textract_response_parser_1.TextractDocument(response.data);
                show_message('Adding response to cache.', -1);
                OCRStates[currentImageID] = layoutsFromTextract;
                processTextractResponse(currentImageID);
            }).catch((err) => {
                show_message('Unable to connect to AWS Textract.');
                console.log(err);
                ocrBridge.disabled = false;
                ocrMenuItem.innerHTML = formerItemString;
            });
        }
    }
}
function processTextractResponse(filename) {
    show_message('Processing Textract response with Spatial Indexing...', -1);
    const layoutsFromTextract = OCRStates[filename];
    const pageHeight = _via_current_image_height;
    const pageWidth = _via_current_image_width;
    const regions = _via_img_metadata[_via_image_id].regions;
    const tree = new rbush_1.default();
    // 2. Prepare Data Structures
    // This map will store the array of words found for each region index
    // Key: Region Index (i), Value: Array of text strings
    const regionTextMap = new Map();
    const spatialItems = [];
    // 3. Build the Index (Iterate Regions ONCE)
    if (regions.length !== 0) {
        for (let i = 0; i < regions.length; ++i) {
            const rattr = regions[i].region_attributes;
            const sattr = regions[i].shape_attributes;
            // Only process relevant region types
            if (['Headline', 'Body', 'Byline', 'Lead'].includes(rattr.Type) && rattr['Freeze Text'] != 'Yes') {
                // Calculate the bounding box for the spatial index
                const bbox = getRegionBoundingBox(sattr);
                if (bbox) {
                    // Add to spatial items list
                    spatialItems.push({
                        minX: bbox.minX,
                        minY: bbox.minY,
                        maxX: bbox.maxX,
                        maxY: bbox.maxY,
                        regionIndex: i, // Store index to look up later
                        sattr: sattr // Store shape details for fine-grained check
                    });
                    // Initialize the bucket for this region
                    regionTextMap.set(i, []);
                }
            }
        }
        // Bulk load regions into the R-Tree (Much faster than inserting one by one)
        tree.load(spatialItems);
    }
    // 4. Query the Index (Iterate Words ONCE)
    try {
        for (const page of layoutsFromTextract.iterPages()) {
            for (const layLines of page.iterLines()) {
                for (const layItem of layLines.iterWords()) {
                    // Calculate Word Dimensions
                    const boxX = Math.round(layItem.geometry.boundingBox.left * pageWidth);
                    const boxY = Math.round(layItem.geometry.boundingBox.top * pageHeight);
                    const boxH = Math.round(layItem.geometry.boundingBox.height * pageHeight);
                    const boxW = Math.round(layItem.geometry.boundingBox.width * pageWidth);
                    const wordBBox = {
                        minX: boxX,
                        minY: boxY,
                        maxX: boxX + boxW,
                        maxY: boxY + boxH
                    };
                    const boxDimensions = { x: boxX, y: boxY, height: boxH, width: boxW };
                    // FAST: Query the tree for regions that *might* overlap this word
                    const candidates = tree.search(wordBBox);
                    // SLOW: Perform precise geometric check only on the candidates
                    for (const candidate of candidates) {
                        let isInside = false;
                        if (candidate.sattr.name == "rect") {
                            isInside = isMostOfBoxAUnderBoxB(boxDimensions, candidate.sattr);
                        }
                        else if (candidate.sattr.name == "polygon") {
                            isInside = isMostOfBoxInPolygon(boxDimensions, candidate.sattr);
                        }
                        if (isInside) {
                            // If it matches, add the word to that specific region's bucket
                            // Note: Words are processed in reading order, so push maintains order
                            regionTextMap.get(candidate.regionIndex).push(layItem.text);
                        }
                    }
                }
            }
        }
    }
    catch (err) {
        console.error("Error during word iteration:", err);
    }
    // 5. Update VIA Regions with Collected Text
    regionTextMap.forEach((words, index) => {
        if (words.length > 0) {
            const fullText = words.join(' ');
            try {
                nat_update_region_attribute(_via_image_id, index, 'Text', fullText);
            }
            catch (err) {
                console.error('Unable to update region attribute:', err);
            }
        }
    });
    processText(); // Continue with your existing logic
    show_message('Textract Processing Done.');
}
function processText() {
    show_message('Generating Article Text...', -1);
    // 1. Setup Data
    const regions = _via_img_metadata[_via_image_id].regions;
    if (regions.length === 0)
        return;
    const childIndex = new rbush_1.default();
    const childItems = [];
    // 2. Build Index of Potential Children (Headline, Body, Lead, Byline)
    // We do this FIRST so we can query it later.
    for (let i = 0; i < regions.length; ++i) {
        const r = regions[i];
        const type = r.region_attributes.Type;
        if (['Headline', 'Body', 'Byline', 'Lead'].includes(type)) {
            const bbox = getRegionBoundingBox(r.shape_attributes); // Use the helper from previous answer
            if (bbox) {
                childItems.push({
                    minX: bbox.minX,
                    minY: bbox.minY,
                    maxX: bbox.maxX,
                    maxY: bbox.maxY,
                    index: i,
                    data: r // Store reference to region data
                });
            }
        }
    }
    childIndex.load(childItems);
    // 3. Process Parents (Articles/Items)
    for (let g = 0; g < regions.length; ++g) {
        const parent = regions[g];
        const pRattr = parent.region_attributes;
        const pSattr = parent.shape_attributes;
        // Only process Articles/Items that aren't frozen
        if (['Article', 'Item'].includes(pRattr.Type) && pRattr['Freeze Text'] != 'Yes') {
            // A. Get Parent Bounding Box
            const pBbox = getRegionBoundingBox(pSattr);
            if (!pBbox)
                continue;
            // B. Query Index: Find all children that physically overlap this Article
            // This replaces the inner loop of "for (j=0...)"
            const candidates = childIndex.search(pBbox);
            const confirmedChildren = [];
            // C. Precise Verification
            for (const item of candidates) {
                const childRegion = item.data;
                const childSattr = childRegion.shape_attributes;
                // Check: Is this child *actually* inside the parent?
                // We reuse our helper which now handles both Rects and Polygons
                // Note: We might need to adapt isMostOfBoxInPolygon to handle "Shape inside Shape"
                // For simplicity, let's treat the child BBox as the "Box" we are checking
                const childRect = {
                    x: item.minX, y: item.minY,
                    width: item.maxX - item.minX,
                    height: item.maxY - item.minY
                };
                let isInside = false;
                if (pSattr.name === 'rect') {
                    isInside = isMostOfBoxAUnderBoxB(childRect, pSattr);
                }
                else if (pSattr.name === 'polygon') {
                    isInside = isMostOfBoxInPolygon(childRect, pSattr);
                }
                if (isInside) {
                    confirmedChildren.push(childRegion);
                }
            }
            // D. Sort & Assemble Text (Logic mostly unchanged)
            const headlineObj = confirmedChildren.find(r => r.region_attributes.Type === "Headline");
            const bylineObj = confirmedChildren.find(r => r.region_attributes.Type === "Byline");
            const leadObj = confirmedChildren.find(r => r.region_attributes.Type === "Lead");
            // Sort body parts by X coordinate (or Y if you prefer)
            const bodyObjs = confirmedChildren.filter(r => r.region_attributes.Type === "Body");
            bodyObjs.sort((a, b) => a.shape_attributes.x - b.shape_attributes.x);
            const headlineText = headlineObj ? (headlineObj.region_attributes.Text || 'NA') : 'NA';
            const bylineText = bylineObj ? (bylineObj.region_attributes.Text || 'NA') : 'NA';
            const leadText = leadObj ? leadObj.region_attributes.Text : '';
            const bodyText = bodyObjs.map(r => r.region_attributes.Text || '').join('\n');
            let finalString = "";
            if (pRattr.Type == "Item") {
                finalString = [headlineText, bylineText, leadText, bodyText].join('\n');
            }
            else {
                finalString = [
                    'HEADLINE: ' + headlineText,
                    '',
                    'BYLINE: ' + bylineText,
                    '',
                    leadText,
                    bodyText
                ].join('\n');
            }
            // Cleanup weird regex artifacts if needed
            finalString = finalString.replace(new RegExp('(\\w*)- (\\w*)', 'g'), '$1$2');
            // Update the Parent Region
            try {
                nat_update_region_attribute(_via_image_id, g, 'Text', finalString);
            }
            catch (err) {
                console.error('Error updating text:', err);
            }
        }
    }
    show_message('Text Generation Complete.');
}
function nat_update_region_attribute(imgID, regionID, attrToUpdate, newValue) {
    _via_img_metadata[imgID].regions[regionID].region_attributes[attrToUpdate] = newValue;
    annotation_editor_on_metadata_update_done('region', attrToUpdate, 1);
    annotation_editor_update_content();
}
function isMostOfBoxAUnderBoxB(boxA, boxB) {
    // 1. AABB Pre-check (The Cheap Filter)
    // If the boundaries don't even touch, don't do math.
    if (boxA.x > boxB.x + boxB.width ||
        boxA.x + boxA.width < boxB.x ||
        boxA.y > boxB.y + boxB.height ||
        boxA.y + boxA.height < boxB.y) {
        return false;
    }
    // 2. Precise Calculation
    // Same logic as before, but protected by the check above
    const xA = boxA.x, yA = boxA.y, wA = boxA.width, hA = boxA.height;
    const xB = boxB.x, yB = boxB.y, wB = boxB.width, hB = boxB.height;
    const xIntersection = Math.max(xA, xB);
    const yIntersection = Math.max(yA, yB);
    const wIntersection = Math.min(xA + wA, xB + wB) - xIntersection;
    const hIntersection = Math.min(yA + hA, yB + hB) - yIntersection;
    if (wIntersection > 0 && hIntersection > 0) {
        const areaIntersection = wIntersection * hIntersection;
        const areaA = wA * hA;
        return areaIntersection > (areaA * 0.5); // > 50% overlap
    }
    return false;
}
function isMostOfBoxInPolygon(box, polygonSattr) {
    // 1. Calculate Polygon Bounding Box (AABB) for Pre-check
    const polyXs = polygonSattr.all_points_x;
    const polyYs = polygonSattr.all_points_y;
    const polyMinX = Math.min(...polyXs);
    const polyMaxX = Math.max(...polyXs);
    const polyMinY = Math.min(...polyYs);
    const polyMaxY = Math.max(...polyYs);
    // 2. AABB Pre-check
    // Does the Word Box overlap with the Polygon's Bounding Box?
    if (box.x > polyMaxX ||
        box.x + box.width < polyMinX ||
        box.y > polyMaxY ||
        box.y + box.height < polyMinY) {
        return false;
    }
    // 3. Precise Clipping using Turf.js
    try {
        // Convert to Turf Polygons
        const wordPoly = turf_1.default.bboxPolygon([box.x, box.y, box.x + box.width, box.y + box.height]);
        // VIA polygon points need to be closed (first point == last point)
        const polyCoords = polyXs.map((x, i) => [x, polyYs[i]]);
        if (polyCoords[0][0] !== polyCoords[polyCoords.length - 1][0] ||
            polyCoords[0][1] !== polyCoords[polyCoords.length - 1][1]) {
            polyCoords.push(polyCoords[0]);
        }
        const regionPoly = turf_1.default.polygon([polyCoords]);
        // Calculate Intersection
        const intersection = turf_1.default.intersect(wordPoly, regionPoly);
        if (!intersection)
            return false;
        // Compare Areas
        const intersectArea = turf_1.default.area(intersection);
        const wordArea = turf_1.default.area(wordPoly);
        return intersectArea > (wordArea * 0.5);
    }
    catch (e) {
        console.warn("Geometry error:", e);
        return false;
    }
}
// Helper function to check if a point is inside a polygon using the ray-casting algorithm
function isPointInPolygon(x, y, polygon) {
    let inside = false;
    const { all_points_x, all_points_y } = polygon;
    const n = all_points_x.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = all_points_x[i], yi = all_points_y[i];
        const xj = all_points_x[j], yj = all_points_y[j];
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect)
            inside = !inside;
    }
    return inside;
}
// Helper function to check if a point is inside a rectangle (bounding box)
function isPointInBox(x, y, box) {
    return (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height);
}
// Helper function to calculate the area of a polygon using the Shoelace theorem
function polygonArea(polygon) {
    const { all_points_x, all_points_y } = polygon;
    const n = all_points_x.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += all_points_x[i] * all_points_y[j];
        area -= all_points_y[i] * all_points_x[j];
    }
    area = Math.abs(area) / 2;
    return area;
}
// Helper function to calculate the area of a rectangle
function boxArea(box) {
    return box.width * box.height;
}
// Main function to check if the first shape is mostly contained within the second shape
function isShapeMostlyContained(shapeA, shapeB, resolution = 10) {
    let insideCount = 0;
    let totalPoints = 0;
    let areaA;
    if (shapeA.all_points_x) {
        // Shape A is a polygon
        areaA = polygonArea(shapeA);
        const { all_points_x, all_points_y } = shapeA;
        const xMin = Math.min(...all_points_x);
        const xMax = Math.max(...all_points_x);
        const yMin = Math.min(...all_points_y);
        const yMax = Math.max(...all_points_y);
        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                const x = xMin + (i / (resolution - 1)) * (xMax - xMin);
                const y = yMin + (j / (resolution - 1)) * (yMax - yMin);
                if (isPointInPolygon(x, y, shapeA)) {
                    totalPoints++;
                    if (shapeB.all_points_x ? isPointInPolygon(x, y, shapeB) : isPointInBox(x, y, shapeB)) {
                        insideCount++;
                    }
                }
            }
        }
    }
    else {
        // Shape A is a rectangle (bounding box)
        areaA = boxArea(shapeA);
        const xStart = shapeA.x;
        const yStart = shapeA.y;
        const width = shapeA.width;
        const height = shapeA.height;
        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                const x = xStart + (i / (resolution - 1)) * width;
                const y = yStart + (j / (resolution - 1)) * height;
                totalPoints++;
                if (shapeB.all_points_x ? isPointInPolygon(x, y, shapeB) : isPointInBox(x, y, shapeB)) {
                    insideCount++;
                }
            }
        }
    }
    return (insideCount / totalPoints) > 0.5;
}
