// 取得容器
const container = document.getElementById('canvas-container');

// 場景、攝影機、渲染器初始化
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // 天空顏色
scene.fog = new THREE.Fog(0x87CEEB, 20, 60);  // 加入霧氣增加空間感

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// 較低俯視角，視線更接近水平方向 (配合貓咪新位置 z=16)
camera.position.set(0, 6.4, 27.2);
camera.lookAt(0, 0, 16);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// 限制 pixel ratio 最高 1.5：retina 螢幕 devicePixelRatio 常常是 2~3，
// 等於每幀要算 4~9 倍像素。capping 之後畫質仍然清楚，FPS 通常翻倍
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true; // 啟用陰影
// 場景大部分是靜態的，不需每幀重算 shadow map，改成動畫迴圈內定期手動更新
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true; // 開場 bake 一次
container.appendChild(renderer.domElement);

// 加入光線
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
// shadow map 從 512 → 256 (像素數 1/4)，配合下面的「不每幀更新」效能提升很明顯
dirLight.shadow.mapSize.width = 256;
dirLight.shadow.mapSize.height = 256;
dirLight.shadow.camera.left = -40;
dirLight.shadow.camera.right = 40;
dirLight.shadow.camera.top = 40;
dirLight.shadow.camera.bottom = -40;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 100;
dirLight.shadow.bias = -0.001;
scene.add(dirLight);

// 簡單的偽亂數生成器，讓重新整理後的植物與樹木位置固定
let seed = 12345;
function random() {
    let x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

// ========================
// 建立 Low Poly 環境 (草地)
// ========================
const groundSize = 65; // 地圖變大30%
const groundSegments = 25; // 減少面數
const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, groundSegments, groundSegments);
groundGeo.rotateX(-Math.PI / 2);

// 擾動頂點以產生 Low Poly 的高低起伏
const positions = groundGeo.attributes.position;
for (let i = 0; i < positions.count; i++) {
    // 中間平坦一點，面數與高度起伏調整
    let x = positions.getX(i);
    let z = positions.getZ(i);
    let distance = Math.sqrt(x*x + z*z);
    let height = random() * (distance / 20) * 0.48; // 地形起伏再增加 20% (由 0.4 -> 0.48)
    positions.setY(i, height);
}
groundGeo.computeVertexNormals();

const groundMat = new THREE.MeshStandardMaterial({ 
    color: 0x2e592e, // 更深一點的綠色
    flatShading: true // 開啟 Low Poly 平坦著色
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);

// ========================
// 建立 Low Poly 樹木與植被
// ========================
const treePositions = []; // 儲存樹木位置以進行碰撞偵測

const placementRaycaster = new THREE.Raycaster();
const downVec = new THREE.Vector3(0, -1, 0);

function getGroundHeight(x, z) {
    placementRaycaster.set(new THREE.Vector3(x, 50, z), downVec);
    const intersects = placementRaycaster.intersectObject(ground);
    return intersects.length > 0 ? intersects[0].point.y : 0;
}

function checkTreeCollision(x, z, minDistance) {
    for (let pos of treePositions) {
        const dx = pos.x - x;
        const dz = pos.z - z;
        if (Math.sqrt(dx * dx + dz * dz) < minDistance) return true;
    }
    return false;
}

function createTree(x, z) {
    // 檢查樹木與樹木之間是否重疊 (半徑設為3.0確保不會交疊)
    if (checkTreeCollision(x, z, 3.0)) return false;

    const tree = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, flatShading: true });
    
    // 主樹幹 (拉長 20%: 2.0 → 2.4)
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 2.4, 7);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.2; // 中心上移 0.2 讓底部仍貼地
    trunk.castShadow = true;
    tree.add(trunk);

    // 側邊樹枝 (隨樹幹上移 0.4 保持比例)
    const branchGeo = new THREE.CylinderGeometry(0.12, 0.25, 1.4, 5);
    const branch1 = new THREE.Mesh(branchGeo, trunkMat);
    branch1.position.set(0.5, 1.6, 0);
    branch1.rotation.z = -Math.PI / 4;
    branch1.castShadow = true;
    tree.add(branch1);

    const branch2 = new THREE.Mesh(branchGeo, trunkMat);
    branch2.position.set(-0.4, 1.9, 0.4);
    branch2.rotation.z = Math.PI / 5;
    branch2.rotation.x = Math.PI / 4;
    branch2.castShadow = true;
    tree.add(branch2);

    // 樹葉 (多叢樹葉構成更細緻的 Low Poly 感)
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, flatShading: true });

    // 樹冠整體上移 0.4 跟著拉長後的樹幹
    const leafPositions = [
        {x: 0,    y: 2.9, z: 0,    radius: 1.2}, // 主幹頂端
        {x: 0.9,  y: 2.2, z: 0,    radius: 0.9}, // branch 1 末端
        {x: -0.8, y: 2.5, z: 0.8,  radius: 0.8}, // branch 2 末端
        {x: 0.4,  y: 2.6, z: 0.6,  radius: 0.8}, // 補空隙
        {x: -0.4, y: 2.7, z: -0.5, radius: 0.9},
        {x: 0,    y: 3.6, z: 0,    radius: 0.7}  // 頂部點綴
    ];
    
    leafPositions.forEach(pos => {
        const geo = new THREE.DodecahedronGeometry(pos.radius, 0); // detail 0 for low poly
        const mesh = new THREE.Mesh(geo, leavesMat);
        mesh.position.set(pos.x, pos.y, pos.z);
        // 給一點隨機旋轉，讓不規則感更強
        mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
        mesh.scale.set(1, 0.8 + random()*0.4, 1); // 稍微壓扁或拉長
        mesh.castShadow = true;
        tree.add(mesh);
    });

    // 樹木再次變大 10% (疊加上次變大)
    tree.scale.set(1.43, 1.43, 1.43);

    // 透過射線完美貼合改變後的地形高度
    tree.position.set(x, getGroundHeight(x, z), z);
    scene.add(tree);
    
    treePositions.push({x: x, z: z}); // 記錄位置
    return true;
}

// ========================
// 邊緣樹牆生成 (2-3排樹木厚度)
// ========================
// 重設亂數種子，確保樹木 / 花 / 草的位置每次重新整理都完全相同
seed = 12345;
const edgeBase = 32.5;
for (let row = 0; row < 3; row++) {
    let edgeDist = edgeBase - row * 3.5; // 加大排距避免重疊
    for (let i = -edgeDist; i <= edgeDist; i += 3.5) { // 加大間距避免重疊
        createTree(i + (random() - 0.5), edgeDist + (random() - 0.5));
        createTree(i + (random() - 0.5), -edgeDist + (random() - 0.5));
        createTree(edgeDist + (random() - 0.5), i + (random() - 0.5));
        createTree(-edgeDist + (random() - 0.5), i + (random() - 0.5));
    }
}

// 隨機生成樹木 (內部點綴，讓中間區域有更多樹但不會過多)
let placedTrees = 0;
let attempts = 0;
while (placedTrees < 30 && attempts < 400) {
    attempts++;
    let tx = (random() - 0.5) * 45;
    let tz = (random() - 0.5) * 45;

    // 桌子周圍保留淨空 (中心 8x8)，蛋糕視野不被擋住
    if (Math.abs(tx) < 4 && Math.abs(tz) < 4) continue;
    // 從鏡頭到貓咪的視線通道完全淨空，避免有樹擋在中間
    // 範圍: x 在 ±3.5、z 從 5 到 21
    if (Math.abs(tx) < 3.5 && tz > 5 && tz < 21) continue;
    // KITTY 氣球區域 (z ≈ -5.5、x 範圍 ±2.6) 周圍保留淨空，避免樹擋住氣球
    if (Math.abs(tx) < 5 && tz > -8 && tz < -3) continue;

    if (createTree(tx, tz)) {
        placedTrees++;
    }
}

// ========================
// 植被與隨風擺動設定
// ========================
const swayObjects = []; // 儲存需要擺動的草與花叢
const clumpPositions = []; // 儲存草叢中心點，避免草叢之間重疊

const flowerColors = [0xffb6c1, 0xffa500, 0xffffff, 0x87ceeb, 0xff69b4, 0xdda0dd];
function createVegetationClump(tx, tz) {
    // 1. 與樹木的碰撞檢查 (草叢不能緊貼樹幹)
    if (checkTreeCollision(tx, tz, 1.6)) return false;
    // 2. 與其他草叢的碰撞檢查
    for (let p of clumpPositions) {
        const dx = p.x - tx;
        const dz = p.z - tz;
        if (Math.sqrt(dx * dx + dz * dz) < 1.4) return false;
    }

    const clump = new THREE.Group();
    
    // 記錄群集內部的子物件位置以此作為距離偵測，確保草和花不重疊
    const localPositions = [];
    function checkLocalCollision(lx, lz, minDst) {
        for (let pos of localPositions) {
            const dx = pos.x - lx;
            const dz = pos.z - lz;
            if (Math.sqrt(dx*dx + dz*dz) < minDst) return true;
        }
        return false;
    }

    // 草叢 - 變得更高更茂密
    const grassGeo = new THREE.ConeGeometry(0.1, 0.6 + random() * 0.4, 3);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x55aa55, flatShading: true });
    
    const blades = 5 + Math.floor(random() * 4); // 5 到 8 根草
    let attempts = 0;
    let placedBlades = 0;
    while (placedBlades < blades && attempts < 50) {
        attempts++;
        let lx = (random() - 0.5) * 0.7; // 稍微拉開範圍
        let lz = (random() - 0.5) * 0.7;
        
        if (!checkLocalCollision(lx, lz, 0.15)) { // 草與草之間距離
            const blade = new THREE.Mesh(grassGeo, grassMat);
            blade.position.set(lx, 0.3, lz);
            blade.rotation.x = (random() - 0.5) * 0.4;
            blade.rotation.z = (random() - 0.5) * 0.4;
            blade.rotation.y = random() * Math.PI * 2;
            blade.castShadow = true;
            clump.add(blade);
            localPositions.push({x: lx, z: lz});
            placedBlades++;
        }
    }
    
    // 是否要在草叢中加入花朵 (花朵機率大幅增加)
    if (random() > 0.4) { // 機率增加
        const numFlowers = 3 + Math.floor(random() * 4); // 數量增加 50%
        let placedFlowers = 0;
        let flowerAttempts = 0;
        
        while (placedFlowers < numFlowers && flowerAttempts < 50) {
            flowerAttempts++;
            let lx = (random() - 0.5) * 0.7; // 稍微拉開範圍
            let lz = (random() - 0.5) * 0.7;
            
            if (!checkLocalCollision(lx, lz, 0.2)) { // 花與花、草之間距離更寬
                const flower = new THREE.Group();
                
                // 莖
                const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4);
                const stemMat = new THREE.MeshStandardMaterial({ color: 0x3cb371, flatShading: true });
                const stem = new THREE.Mesh(stemGeo, stemMat);
                stem.position.y = 0.25;
                stem.castShadow = true;
                flower.add(stem);
                
                // 葉子
                const leafGeo = new THREE.ConeGeometry(0.06, 0.2, 3);
                const leaf1 = new THREE.Mesh(leafGeo, stemMat);
                leaf1.position.set(0.06, 0.15, 0);
                leaf1.rotation.z = -Math.PI / 4;
                flower.add(leaf1);
                
                const leaf2 = new THREE.Mesh(leafGeo, stemMat);
                leaf2.position.set(-0.06, 0.25, 0);
                leaf2.rotation.z = Math.PI / 4;
                flower.add(leaf2);
                
                // 花蕊
                const centerGeo = new THREE.DodecahedronGeometry(0.06);
                const centerMat = new THREE.MeshStandardMaterial({ color: 0xffdb58, flatShading: true });
                const center = new THREE.Mesh(centerGeo, centerMat);
                center.position.y = 0.5;
                flower.add(center);
                
                // 花瓣
                const petalColor = flowerColors[Math.floor(random() * flowerColors.length)];
                const petalMat = new THREE.MeshStandardMaterial({ color: petalColor, flatShading: true });
                const petalGeo = new THREE.SphereGeometry(0.05, 4, 3); 
                petalGeo.scale(1, 0.2, 2); 
                
                const numPetals = 5 + Math.floor(random() * 3); 
                for (let p = 0; p < numPetals; p++) {
                    const petal = new THREE.Mesh(petalGeo, petalMat);
                    const angle = (p / numPetals) * Math.PI * 2;
                    petal.position.set(Math.cos(angle) * 0.08, 0.5, Math.sin(angle) * 0.08);
                    petal.rotation.y = -angle; 
                    petal.rotation.z = Math.PI / 8; 
                    flower.add(petal);
                }
                
                // 讓花不重疊安置
                flower.position.set(lx, 0, lz);
                flower.rotation.y = random() * Math.PI * 2;
                flower.rotation.x = (random() - 0.5) * 0.3;
                flower.rotation.z = (random() - 0.5) * 0.3;
                clump.add(flower);
                localPositions.push({x: lx, z: lz});
                placedFlowers++;
            }
        }
    }
    
    clump.position.set(tx, getGroundHeight(tx, tz), tz);
    
    // 紀錄初始旋轉，方便之後風吹擺動
    clump.userData.initRotX = clump.rotation.x;
    clump.userData.initRotZ = clump.rotation.z;
    clump.userData.swayOffset = random() * Math.PI * 2; // 亂數偏移避免同頻率擺動
    
    scene.add(clump);
    swayObjects.push(clump);
    clumpPositions.push({ x: tx, z: tz });
    return true;
}

// 產生草叢 (使用 while 迴圈與重試上限，遇到碰撞就換位置重新嘗試)
let placedClumps = 0;
let clumpAttempts = 0;
while (placedClumps < 90 && clumpAttempts < 700) {
    clumpAttempts++;
    // 草叢只生在內部 ±22 範圍 (60 → 44)，地圖邊緣 (靠近樹牆) 保持空曠
    let tx = (random() - 0.5) * 44;
    let tz = (random() - 0.5) * 44;

    // 留開中心區域，避免擋住貓咪與中央木桌
    if (Math.abs(tx) > 4 || Math.abs(tz) > 4) {
        if (createVegetationClump(tx, tz)) {
            placedClumps++;
        }
    }
}

// ========================
// 建立中心點的木頭桌子與生日蛋糕
// ========================
const tableGroup = new THREE.Group();

// 桌腳
const legMat = new THREE.MeshStandardMaterial({ color: 0xe6c280, flatShading: true }); // 較淡溫暖的木頭顏色
const tableLegGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 5);
const leg1 = new THREE.Mesh(tableLegGeo, legMat); leg1.position.set(-1, 0.6, -1); leg1.castShadow = true;
const leg2 = new THREE.Mesh(tableLegGeo, legMat); leg2.position.set(1, 0.6, -1); leg2.castShadow = true;
const leg3 = new THREE.Mesh(tableLegGeo, legMat); leg3.position.set(-1, 0.6, 1); leg3.castShadow = true;
const leg4 = new THREE.Mesh(tableLegGeo, legMat); leg4.position.set(1, 0.6, 1); leg4.castShadow = true;
tableGroup.add(leg1, leg2, leg3, leg4);

// 桌面
const tableTopGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.2, 12);
const tableTop = new THREE.Mesh(tableTopGeo, legMat);
tableTop.position.y = 1.25;
tableTop.castShadow = true;
tableTop.receiveShadow = true;
tableGroup.add(tableTop);

// 生日蛋糕 (桌面寬度不變，蛋糕本體放大 2 倍)
const cakeMat1 = new THREE.MeshStandardMaterial({ color: 0xffadc9, flatShading: true }); // 粉紅糖霜
const cakeMat2 = new THREE.MeshStandardMaterial({ color: 0xf5f5dc, flatShading: true }); // 蛋糕體

// 桌面頂端 y = 1.25 + 0.1 = 1.35，底層蛋糕高 0.88，所以中心放 1.79 讓底貼桌面
const cakeGeo1 = new THREE.CylinderGeometry(1.32, 1.32, 0.88, 10);
const cakeGeo2 = new THREE.CylinderGeometry(0.88, 0.88, 0.88, 10);
const cakeLayer1 = new THREE.Mesh(cakeGeo1, cakeMat2); cakeLayer1.position.y = 1.79; cakeLayer1.castShadow = true;
const cakeLayer2 = new THREE.Mesh(cakeGeo2, cakeMat1); cakeLayer2.position.y = 2.67; cakeLayer2.castShadow = true;
tableGroup.add(cakeLayer1, cakeLayer2);

// 取得蛋糕頂部中央位置
const cakeTopY = 2.67 + 0.44; // 上層蛋糕頂端 = 3.11
const candleY = cakeTopY + 0.08; // 預留 2x 縮放後蠟燭底部方塊半個高度，讓蠟燭剛好坐在蛋糕上

// 蠟燭火焰動畫陣列
const flames = [];

// 蠟燭 (數字 2 和 4，變大兩倍，並改為黃色)
function createNumberCandle(numStr) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffcc00, flatShading: true });
    // 0.04 是原始大小，兩倍為 0.08
    const s = 0.08; 
    const geo = new THREE.BoxGeometry(s, s, s);
    
    // 簡單的 3x5 像素方格
    const blocks2 = [[0,4],[1,4],[2,4], [2,3], [0,2],[1,2],[2,2], [0,1], [0,0],[1,0],[2,0]];
    const blocks4 = [[0,4],[2,4], [0,3],[2,3], [0,2],[1,2],[2,2], [2,1], [2,0]];
    
    const layout = numStr === '2' ? blocks2 : blocks4;
    layout.forEach(([x, y]) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x*s - s, y*s, 0); // 置中
        mesh.castShadow = true;
        group.add(mesh);
    });
    
    // 燭芯與兩倍大火焰
    const flameGeo = new THREE.ConeGeometry(0.08, 0.2, 4);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 }); // 火焰發光材質
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(0, 5*s + 0.1, 0);
    group.add(flame);
    
    flames.push(flame);
    return group;
}

// 桌子位置 (z=-4.5，再向後挪 1.5 單位，氣球會跟著一起移)
const tableX = 0;
const tableZ = -4.5;
let tableGroundHeight = getGroundHeight(tableX, tableZ);
const candle2 = createNumberCandle('2');
const candle4 = createNumberCandle('4');
// 蠟燭整體再放大 2 倍 (原本就是 0.08 方塊，2x 後達到顯眼大小)
candle2.scale.set(2, 2, 2);
candle4.scale.set(2, 2, 2);
// 重新置中於蛋糕頂部，左右拉開保留小縫隙，避免兩根貼合在一起
candle2.position.set(-0.30, candleY, 0);
candle4.position.set(0.30, candleY, 0);
tableGroup.add(candle2, candle4);
// 整組 (桌子 + 蛋糕 + 蠟燭) 等比例縮放 (原為 0.5，放大 1.4 倍 -> 0.7)
tableGroup.scale.set(0.7, 0.7, 0.7);
tableGroup.position.set(tableX, tableGroundHeight, tableZ);
scene.add(tableGroup);

// 桌子碰撞改用獨立 isNearTable() 處理 (碰撞半徑配合桌子實際大小，避免空氣牆)
// 桌面實際半徑 ≈ 1.6 × 0.7 = 1.12，再多 0.18 緩衝
const tableCenter = { x: tableX, z: tableZ };
const tableCollisionRadius = 1.3;
function isNearTable(x, z) {
    const dx = tableCenter.x - x;
    const dz = tableCenter.z - z;
    return Math.sqrt(dx * dx + dz * dz) < tableCollisionRadius;
}

// ========================
// 蛋糕後方 KITTY 字母氣球 (一排有線漂浮)
// ========================
// 字母外框 Shape 定義 (一筆畫描出整個字母輪廓)
function createKShape() {
    const s = new THREE.Shape();
    const Lx = -0.35, Rx = -0.10;    // 左豎條左右邊
    const tipX = 0.35, H = 0.7;       // 字母最右尖端 x、半高
    const armT = 0.18, gapHalf = 0.1; // 上下分叉的厚度與中央間距
    s.moveTo(Lx, H);
    s.lineTo(Rx, H);
    s.lineTo(Rx, gapHalf + armT);
    s.lineTo(tipX, H);
    s.lineTo(tipX, H - armT);
    s.lineTo(Rx, gapHalf);
    s.lineTo(Rx, -gapHalf);
    s.lineTo(tipX, -H + armT);
    s.lineTo(tipX, -H);
    s.lineTo(Rx, -gapHalf - armT);
    s.lineTo(Rx, -H);
    s.lineTo(Lx, -H);
    s.closePath();
    return s;
}
function createIShape() {
    const s = new THREE.Shape();
    const VW = 0.13, H = 0.7, W = 0.35, SH = 0.18;
    s.moveTo(-W, H);
    s.lineTo(W, H);
    s.lineTo(W, H - SH);
    s.lineTo(VW, H - SH);
    s.lineTo(VW, -H + SH);
    s.lineTo(W, -H + SH);
    s.lineTo(W, -H);
    s.lineTo(-W, -H);
    s.lineTo(-W, -H + SH);
    s.lineTo(-VW, -H + SH);
    s.lineTo(-VW, H - SH);
    s.lineTo(-W, H - SH);
    s.closePath();
    return s;
}
function createTShape() {
    const s = new THREE.Shape();
    const VW = 0.13, H = 0.7, W = 0.35, SH = 0.18;
    s.moveTo(-W, H);
    s.lineTo(W, H);
    s.lineTo(W, H - SH);
    s.lineTo(VW, H - SH);
    s.lineTo(VW, -H);
    s.lineTo(-VW, -H);
    s.lineTo(-VW, H - SH);
    s.lineTo(-W, H - SH);
    s.closePath();
    return s;
}
function createYShape() {
    const s = new THREE.Shape();
    const W = 0.35, H = 0.7, VW = 0.13;
    // Y 用「頂部橫條 + 收斂到中間 + 下方直線」一筆連續的外框
    s.moveTo(-W, H);
    s.lineTo(W, H);
    s.lineTo(VW, 0);
    s.lineTo(VW, -H);
    s.lineTo(-VW, -H);
    s.lineTo(-VW, 0);
    s.closePath();
    return s;
}

function createLetterBalloon(letter, color) {
    const group = new THREE.Group();
    // 平滑著色 + 微微粗糙度，呈現氣球的柔光感
    const mat = new THREE.MeshStandardMaterial({
        color: color,
        flatShading: false,
        roughness: 0.45,
        metalness: 0.1
    });

    let shape;
    if (letter === 'K')      shape = createKShape();
    else if (letter === 'I') shape = createIShape();
    else if (letter === 'T') shape = createTShape();
    else if (letter === 'Y') shape = createYShape();

    // 透過 ExtrudeGeometry 把 2D 字母輪廓拉成 3D，帶 bevel 讓邊角圓鼓鼓像充氣氣球
    const extrudeSettings = {
        depth: 0.22,
        bevelEnabled: true,
        bevelThickness: 0.12,
        bevelSize: 0.08,
        bevelSegments: 5,
        curveSegments: 8
    };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geo.translate(0, 0, -0.11); // 整體 z 置中 (depth/2)

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    group.add(mesh);

    // 氣球繩 (從字母底部往下垂)
    const stringGeo = new THREE.CylinderGeometry(0.015, 0.015, 2.5, 4);
    const stringMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const string = new THREE.Mesh(stringGeo, stringMat);
    string.position.y = -0.7 - 1.25; // 字母底 (y=-H=-0.7) 再垂下 1.25 (繩長/2) = -1.95
    group.add(string);

    return group;
}

const balloonLetters = ['K', 'I', 'T', 'T', 'Y'];
// 全部統一粉色
const balloonColors = [0xff80c0, 0xff80c0, 0xff80c0, 0xff80c0, 0xff80c0];
const balloonSpacing = 1.3;
const balloonStartX = -((balloonLetters.length - 1) * balloonSpacing) / 2; // 整排置中
const balloonY = 3.5; // 漂浮高度
const balloonZ = tableZ - 2.5; // 蛋糕後方 (tableZ = -3, 所以 z = -5.5)

// 儲存氣球資訊以做隨風飄動動畫
const balloons = [];
balloonLetters.forEach((letter, i) => {
    const balloon = createLetterBalloon(letter, balloonColors[i]);
    const bx = balloonStartX + i * balloonSpacing;
    balloon.position.set(bx, balloonY, balloonZ);
    scene.add(balloon);
    balloons.push({
        mesh: balloon,
        baseX: bx,
        baseY: balloonY,
        baseZ: balloonZ,
        phase: i * 0.7 // 相位錯開讓每顆氣球擺動不同步
    });
});

// ========================
// 紅色長方形小舞台 (位於蛋糕左後方空地的位置標示，不影響原本樹木)
// ========================
const stageX = -15;
const stageZ = -20;
const stageGeo = new THREE.BoxGeometry(10, 1, 3);
const stageMat = new THREE.MeshStandardMaterial({ color: 0xcc2233, flatShading: true });
const stage = new THREE.Mesh(stageGeo, stageMat);
stage.position.set(stageX, getGroundHeight(stageX, stageZ) + 0.15, stageZ);
stage.castShadow = true;
stage.receiveShadow = true;
scene.add(stage);

// ========================
// 舞台上 7 隻不同花色貓咪
// ========================
function createStageCat(bodyColor, accentColor, hatColor) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: bodyColor, flatShading: true });
    const accentMat = accentColor !== null
        ? new THREE.MeshStandardMaterial({ color: accentColor, flatShading: true })
        : mat;

    // 身體
    const sbody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.35), mat);
    sbody.position.set(0, 0.5, -0.075);
    sbody.castShadow = true;
    g.add(sbody);

    // 胸口 / 肚子色塊 (若有 accent)
    if (accentColor !== null) {
        const chest = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.32, 0.7), accentMat);
        chest.position.set(0, 0.38, 0.15);
        g.add(chest);
    }

    // 頭
    const shead = new THREE.Mesh(new THREE.BoxGeometry(0.63, 0.54, 0.63), mat);
    shead.position.set(0, 0.9, 0.75);
    shead.castShadow = true;
    g.add(shead);

    // 耳朵
    const searGeo = new THREE.ConeGeometry(0.15, 0.3, 4);
    const sear1 = new THREE.Mesh(searGeo, mat);
    sear1.position.set(-0.2, 1.3, 0.8);
    g.add(sear1);
    const sear2 = new THREE.Mesh(searGeo, mat);
    sear2.position.set(0.2, 1.3, 0.8);
    g.add(sear2);

    // 尾巴
    const stail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.8), mat);
    stail.position.set(0, 0.7, -0.8);
    stail.rotation.x = Math.PI / 4;
    g.add(stail);

    // 生日帽
    const shat = new THREE.Mesh(
        new THREE.ConeGeometry(0.25, 0.5, 6),
        new THREE.MeshStandardMaterial({ color: hatColor, flatShading: true })
    );
    shat.position.set(0, 1.45, 0.75);
    shat.castShadow = true;
    g.add(shat);
    const spom = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.08, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true })
    );
    spom.position.set(0, 1.73, 0.75);
    g.add(spom);

    g.scale.set(0.9, 0.9, 0.9);
    return g;
}

// 7 隻不同花色 (body / accent / hat)
const stageCatDesigns = [
    { body: 0xffffff, accent: 0xff8c69, hat: 0xff2255 }, // 1. 白底橘斑 + 紅帽
    { body: 0x1a1a1a, accent: null,     hat: 0xffd700 }, // 2. 全黑 + 金帽
    { body: 0xe89042, accent: 0x9d5c1f, hat: 0x33cc66 }, // 3. 橘虎斑 + 綠帽
    { body: 0x7d7d7d, accent: 0xbababa, hat: 0x4488ff }, // 4. 灰白 + 藍帽
    { body: 0x6b4423, accent: 0xc4a373, hat: 0xff80c0 }, // 5. 棕底淺棕 + 粉帽
    { body: 0x1a1a1a, accent: 0xffffff, hat: 0xff5500 }, // 6. 黑白賓士 + 橙帽
    { body: 0xddaadd, accent: 0xffd0e0, hat: 0x9966cc }  // 7. 粉紫 + 紫帽
];

// 舞台中心 (stageX, stageZ)，紅色舞台高度 1，中心 y=ground+0.15，所以頂面 = ground + 0.65
const stageGroundY = getGroundHeight(stageX, stageZ);
const stageTopY = stageGroundY + 0.65;
const stageCatLineLen = 8; // 7 隻沿舞台 X 軸從 -4 到 +4 距中心散開
const stageCatStep = stageCatLineLen / (stageCatDesigns.length - 1);
const stageCats = []; // 之後動畫與音符要用
stageCatDesigns.forEach((d, i) => {
    const c = createStageCat(d.body, d.accent, d.hat);
    const cx = stageX - stageCatLineLen / 2 + i * stageCatStep;
    const baseRotY = (random() - 0.5) * 0.4; // 微微歪斜
    c.position.set(cx, stageTopY, stageZ);
    c.rotation.y = baseRotY;
    scene.add(c);
    stageCats.push({
        mesh: c,
        baseX: cx,
        baseY: stageTopY,
        baseZ: stageZ,
        baseRotY: baseRotY,
        phase: i * 0.55
    });
});

// 舞台 + 舞台貓的碰撞 (主貓不可穿透)
// 舞台 BoxGeometry(10, 1, 3) 中心 (stageX, ?, stageZ)；加 0.4 緩衝
const stageBounds = {
    minX: stageX - 5.0 - 0.4,
    maxX: stageX + 5.0 + 0.4,
    minZ: stageZ - 1.5 - 0.4,
    maxZ: stageZ + 1.5 + 0.4
};
function isInsideStage(x, z) {
    return x > stageBounds.minX && x < stageBounds.maxX &&
           z > stageBounds.minZ && z < stageBounds.maxZ;
}
function isNearAnyStageCat(x, z) {
    for (let si = 0; si < stageCats.length; si++) {
        const sc = stageCats[si];
        const dx = sc.baseX - x;
        const dz = sc.baseZ - z;
        if (Math.sqrt(dx * dx + dz * dz) < 0.85) return true;
    }
    return false;
}

// 舞台貓彈奏狀態 (主貓在舞台附近跳躍落地觸發)
const stageCatState = {
    playing: false,
    t: 0
};
const stageCatStandRotX = -Math.PI / 3;
const stageCatStandLift = 0.31 * 0.9;
const stageCatTriggerRadius = 8.0; // 比黑貓大，因為舞台本身就大

// BTS 音樂 (從第 5 秒開始播放)
const btsMusic = new Audio('bts.mp3');
btsMusic.loop = true;
btsMusic.volume = 0.35;

// ========================
// 舞台左右兩側火花噴泉 (一直開著)
// ========================
const sparks = [];
const sharedSparkGeo = new THREE.SphereGeometry(0.09, 6, 5);
const sparkColors = [0xffff66, 0xffaa00, 0xffd700, 0xff8800, 0xffffff, 0xffe0a0];
const sparkLeftX = stageX - 5;   // 舞台左邊緣
const sparkRightX = stageX + 5;  // 舞台右邊緣
const sparkLeftY = getGroundHeight(sparkLeftX, stageZ) + 0.2;
const sparkRightY = getGroundHeight(sparkRightX, stageZ) + 0.2;
// BT / TS 字母間的火花變數會在 BTS 設定完之後才宣告 (避免 TDZ)
let sparkBTX, sparkTSX, sparkBTY, sparkTSY;

function spawnSpark(x, y, z) {
    const color = sparkColors[Math.floor(Math.random() * sparkColors.length)];
    const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1.0 });
    const spark = new THREE.Mesh(sharedSparkGeo, mat);
    const scale = 0.7 + Math.random() * 0.6;
    spark.scale.set(scale, scale, scale);
    spark.position.set(x, y, z);
    spark.userData = {
        vx: (Math.random() - 0.5) * 0.06,
        vy: 0.25 + Math.random() * 0.15,      // 強力往上噴
        vz: (Math.random() - 0.5) * 0.06,
        life: 1.0
    };
    scene.add(spark);
    sparks.push(spark);
}
let sparkSpawnCounter = 0;

// ========================
// BTS 紅色立體字母 (站在舞台後方地面上)
// ========================
function createBShape() {
    const sh = new THREE.Shape();
    const W = 0.35, H = 0.7, T = 0.15;
    sh.moveTo(-W, H);
    sh.lineTo(W, H);
    sh.lineTo(W, -H);
    sh.lineTo(-W, -H);
    sh.closePath();
    const hole1 = new THREE.Path();
    hole1.moveTo(-W + T, T / 2);
    hole1.lineTo(W - T, T / 2);
    hole1.lineTo(W - T, H - T);
    hole1.lineTo(-W + T, H - T);
    hole1.closePath();
    sh.holes.push(hole1);
    const hole2 = new THREE.Path();
    hole2.moveTo(-W + T, -H + T);
    hole2.lineTo(W - T, -H + T);
    hole2.lineTo(W - T, -T / 2);
    hole2.lineTo(-W + T, -T / 2);
    hole2.closePath();
    sh.holes.push(hole2);
    return sh;
}
function createSShape() {
    // 正確的 S：上方連接器在「左」、下方連接器在「右」(原本寫反了所以看起來是 2)
    const sh = new THREE.Shape();
    const W = 0.35, H = 0.7, T = 0.18;
    sh.moveTo(-W, H);                // 1. 左上
    sh.lineTo(W, H);                 // 2. 東到右上
    sh.lineTo(W, H - T);             // 3. 南，上橫條右側
    sh.lineTo(-W + T, H - T);        // 4. 西，上橫條底部往左到左豎條
    sh.lineTo(-W + T, T / 2);        // 5. 南，左豎條右側
    sh.lineTo(W, T / 2);             // 6. 東，中橫條上緣
    sh.lineTo(W, -H);                // 7. 南，一路到右下 (中橫右側 + 右豎條 + 下橫條右側 都在 x=W)
    sh.lineTo(-W, -H);               // 8. 西，下橫條底部
    sh.lineTo(-W, -H + T);           // 9. 北，下橫條左側
    sh.lineTo(W - T, -H + T);        // 10. 東，下橫條上緣到右豎條
    sh.lineTo(W - T, -T / 2);        // 11. 北，右豎條左側
    sh.lineTo(-W, -T / 2);           // 12. 西，中橫條下緣
    sh.closePath();                  // 北回到 (-W, H)，中橫左側 + 左豎條左側 + 上橫條左側 都在 x=-W
    return sh;
}
const btsRedMat = new THREE.MeshStandardMaterial({
    color: 0xdd2233,
    flatShading: false,
    roughness: 0.45,
    metalness: 0.1
});
const btsExtrudeSettings = {
    depth: 0.28,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.08,
    bevelSegments: 4,
    curveSegments: 8
};
const btsLetters = ['B', 'T', 'S'];
const btsScale = 2.7;            // 1.8 × 1.5 = 2.7，再變大 1.5 倍
const btsSpacing = 1.4 * btsScale;
const btsZ = stageZ - 2.5;       // 舞台後方 2.5 單位
const btsStartX = stageX - (btsLetters.length - 1) * btsSpacing / 2;
btsLetters.forEach((letter, i) => {
    let shape;
    if (letter === 'B') shape = createBShape();
    else if (letter === 'T') shape = createTShape();
    else if (letter === 'S') shape = createSShape();
    const geo = new THREE.ExtrudeGeometry(shape, btsExtrudeSettings);
    geo.translate(0, 0, -0.14);
    const m = new THREE.Mesh(geo, btsRedMat);
    m.castShadow = true;
    m.receiveShadow = true;
    const bx = btsStartX + i * btsSpacing;
    const groundY = getGroundHeight(bx, btsZ);
    // 字母 local y 從 -H 到 H，乘 btsScale 後仍是 -H*scale 到 H*scale
    // 站在地上 → position.y = groundY + H * scale
    m.position.set(bx, groundY + 0.7 * btsScale, btsZ);
    m.scale.set(btsScale, btsScale, btsScale);
    scene.add(m);
});

// BTS 字母間的火花發射點 (要等 btsStartX / btsSpacing / btsZ 都宣告完)
sparkBTX = btsStartX + btsSpacing * 0.5;   // B 與 T 中間
sparkTSX = btsStartX + btsSpacing * 1.5;   // T 與 S 中間
sparkBTY = getGroundHeight(sparkBTX, btsZ) + 0.2;
sparkTSY = getGroundHeight(sparkTSX, btsZ) + 0.2;

// ========================
// 環境氛圍霧氣粒子 (小粒子隨機飄動)
// ========================
const particleCount = 19; // 再次減半 (38 -> 19)
const particleGeo = new THREE.BufferGeometry();
const particlePos = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount; i++) {
    // 只生成在畫面中央區域
    particlePos[i*3+0] = (random() - 0.5) * 18; // x
    particlePos[i*3+1] = random() * 7 + 2;      // y (2~9)
    particlePos[i*3+2] = (random() - 0.5) * 18; // z
}
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
const particleMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.2, // Low poly style square particles
    transparent: true,
    opacity: 0.6,
    // point style defaults to squares which fits low poly
});
const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);

// ========================
// 建立隨機飛舞的彩色小蝴蝶
// ========================
const butterflies = [];
const butterflyColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8800];

for (let i = 0; i < 5; i++) { // 蝴蝶數量 7 → 5 (少 2 隻)
    const bfGroup = new THREE.Group();
    // 身體
    const bBodyGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 4);
    const bBodyMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true });
    const bBody = new THREE.Mesh(bBodyGeo, bBodyMat);
    bBody.rotation.x = Math.PI / 2;
    bfGroup.add(bBody);
    
    // 翅膀
    const bColor = butterflyColors[i % butterflyColors.length];
    const bWingMat = new THREE.MeshStandardMaterial({ color: bColor, flatShading: true, side: THREE.DoubleSide });
    const bWingGeo = new THREE.PlaneGeometry(0.3, 0.25);
    bWingGeo.rotateX(-Math.PI / 2); // 轉向水平，讓拍動時是整片翅膀上下大面積拍舞
    
    // 左邊這片
    const lWing = new THREE.Mesh(bWingGeo, bWingMat);
    lWing.position.set(-0.15, 0, 0);
    const lWingGroup = new THREE.Group();
    lWingGroup.add(lWing);
    
    // 右邊這片
    const rWing = new THREE.Mesh(bWingGeo, bWingMat);
    rWing.position.set(0.15, 0, 0);
    const rWingGroup = new THREE.Group();
    rWingGroup.add(rWing);
    
    bfGroup.add(lWingGroup, rWingGroup);
    
    bfGroup.position.set((Math.random() - 0.5) * 40, 2 + Math.random() * 2, (Math.random() - 0.5) * 40);
    scene.add(bfGroup);
    
    butterflies.push({
        mesh: bfGroup,
        lWing: lWingGroup,
        rWing: rWingGroup,
        target: new THREE.Vector3((Math.random() - 0.5) * 40, 2 + Math.random() * 2, (Math.random() - 0.5) * 40),
        angle: Math.random() * Math.PI * 2,
        speed: 0.04 + Math.random() * 0.02,
        flapSpeed: 0.4 + Math.random() * 0.3,
        timeOffset: Math.random() * 10
    });
}

// ========================
// 建立 Low Poly 貓咪
// ========================
const cat = new THREE.Group();
const catColor = 0xffffff; // 底色改為白貓，用來加上花斑
const catMat = new THREE.MeshStandardMaterial({ color: catColor, flatShading: true });
const spotMat = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, flatShading: true }); // 咖啡色斑點
const darkSpotMat = new THREE.MeshStandardMaterial({ color: 0x333333, flatShading: true }); // 深色斑點

// 身體 (縮短長度 10%，從 1.5 變為 1.35)
const bodyGeo = new THREE.BoxGeometry(0.8, 0.6, 1.35);
const body = new THREE.Mesh(bodyGeo, catMat);
body.position.y = 0.5;
body.position.z = -0.075; // 稍微往後退對齊原來的中心
body.castShadow = true;
cat.add(body);

// 身體斑塊 (配合身體稍微縮短與位移)
const spot1 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.3, 0.45), spotMat);
spot1.position.set(0, 0.6, 0.1);
cat.add(spot1);

const spot2 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.62, 0.35), darkSpotMat);
spot2.position.set(0, 0.5, -0.4);
cat.add(spot2);

const spot3 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.4, 0.2), spotMat); 
spot3.position.set(0, 0.4, -0.15);
cat.add(spot3);

const spot4 = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.2, 0.25), darkSpotMat); 
spot4.position.set(0, 0.65, 0.4);
cat.add(spot4);

// 頭部 (恢復最初的長方體，稍微縮小 10%)
const headGeo = new THREE.BoxGeometry(0.63, 0.54, 0.63);
const head = new THREE.Mesh(headGeo, catMat);
head.position.set(0, 0.9, 0.75);
head.castShadow = true;
cat.add(head);

// 頭部斑塊 (多加一塊)
const headSpot1 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.2, 0.3), spotMat);
headSpot1.position.set(0, 1.05, 0.7);
cat.add(headSpot1);

const headSpot2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.56, 0.65), darkSpotMat); // 臉側邊斑
headSpot2.position.set(0.18, 0.9, 0.75);
cat.add(headSpot2);

// 耳朵 (基本圓錐)
const earGeo = new THREE.ConeGeometry(0.15, 0.3, 4);
const ear1 = new THREE.Mesh(earGeo, spotMat); // 左耳橘色
ear1.position.set(-0.2, 1.3, 0.8);
cat.add(ear1);

const ear2 = new THREE.Mesh(earGeo, darkSpotMat); // 右耳深色
ear2.position.set(0.2, 1.3, 0.8);
cat.add(ear2);

// 生日帽 (置中於頭頂正中央)
const hatGeo = new THREE.ConeGeometry(0.25, 0.5, 6);
const hatMat = new THREE.MeshStandardMaterial({ color: 0xff8c00, flatShading: true }); // 改為橘色生日帽
const hat = new THREE.Mesh(hatGeo, hatMat);
hat.position.set(0, 1.45, 0.75); // Z軸對齊頭部中心 0.75
hat.rotation.x = 0; // 取消傾斜，直立於頭頂
hat.castShadow = true;
cat.add(hat);

// 生日帽頂端白色小球 (對齊置中的帽子)
const pomGeo = new THREE.DodecahedronGeometry(0.08, 1);
const pomMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
const pom = new THREE.Mesh(pomGeo, pomMat);
pom.position.set(0, 1.73, 0.75);
pom.castShadow = true;
cat.add(pom);

// 尾巴
const tailGeo = new THREE.BoxGeometry(0.15, 0.15, 0.8);
const tail = new THREE.Mesh(tailGeo, darkSpotMat); // 黑尾巴
tail.position.set(0, 0.7, -0.8);
tail.rotation.x = Math.PI / 4;
cat.add(tail);

// 移除四隻腳 (依需求)
// 縮小貓咪體型 10%
cat.scale.set(0.9, 0.9, 0.9);

// 將貓咪初始位置放在桌子前方 (Z=16，距離桌子 16 單位，比之前再遠 2 倍)
cat.position.set(0, 0, 16);

scene.add(cat);

// ========================
// 蛋糕旁全黑貓咪 (一樣造型、藍色生日帽、斜斜朝向相機方向)
// ========================
const blackCat = new THREE.Group();
const blackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, flatShading: true });

// 身體
const bcBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.35), blackMat);
bcBody.position.y = 0.5;
bcBody.position.z = -0.075;
bcBody.castShadow = true;
blackCat.add(bcBody);

// 頭
const bcHead = new THREE.Mesh(new THREE.BoxGeometry(0.63, 0.54, 0.63), blackMat);
bcHead.position.set(0, 0.9, 0.75);
bcHead.castShadow = true;
blackCat.add(bcHead);

// 耳朵 (兩耳都黑色)
const bcEarGeo = new THREE.ConeGeometry(0.15, 0.3, 4);
const bcEar1 = new THREE.Mesh(bcEarGeo, blackMat);
bcEar1.position.set(-0.2, 1.3, 0.8);
blackCat.add(bcEar1);
const bcEar2 = new THREE.Mesh(bcEarGeo, blackMat);
bcEar2.position.set(0.2, 1.3, 0.8);
blackCat.add(bcEar2);

// 生日帽 (藍色)
const bcHatGeo = new THREE.ConeGeometry(0.25, 0.5, 6);
const bcHatMat = new THREE.MeshStandardMaterial({ color: 0x4488ff, flatShading: true });
const bcHat = new THREE.Mesh(bcHatGeo, bcHatMat);
bcHat.position.set(0, 1.45, 0.75);
bcHat.castShadow = true;
blackCat.add(bcHat);

// 帽尖白色小球 (跟主貓一樣)
const bcPomGeo = new THREE.DodecahedronGeometry(0.08, 1);
const bcPomMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
const bcPom = new THREE.Mesh(bcPomGeo, bcPomMat);
bcPom.position.set(0, 1.73, 0.75);
bcPom.castShadow = true;
blackCat.add(bcPom);

// 尾巴
const bcTail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.8), blackMat);
bcTail.position.set(0, 0.7, -0.8);
bcTail.rotation.x = Math.PI / 4;
blackCat.add(bcTail);

// 與主貓相同縮小 10%
blackCat.scale.set(0.9, 0.9, 0.9);

// 放在蛋糕右側、與桌子同深度，斜斜朝向相機方向
const blackCatX = 2.3;
const blackCatZ = tableZ;
blackCat.position.set(blackCatX, getGroundHeight(blackCatX, blackCatZ), blackCatZ);
blackCat.rotation.y = -Math.PI / 5; // 約 36 度斜角，反方向 (朝相機左邊 / 蛋糕方向)
scene.add(blackCat);

// 黑貓碰撞 (主貓不可走進黑貓身體)
const blackCatCenter = { x: blackCatX, z: blackCatZ };
const blackCatCollisionRadius = 1.0; // 兩隻貓加總半徑 ≈ 0.7，預留 0.3 緩衝
function isNearBlackCat(x, z) {
    const dx = blackCatCenter.x - x;
    const dz = blackCatCenter.z - z;
    return Math.sqrt(dx * dx + dz * dz) < blackCatCollisionRadius;
}

// 設定旋轉順序為 YXZ，這樣彈奏時可以先朝向某方向，再單純地後仰，不會卡到 -π/5 那個 Y 旋轉
blackCat.rotation.order = 'YXZ';

// ========================
// 黑貓木吉他 (方正圓角琴身，淺木頭色)
// ========================
const guitar = new THREE.Group();
const guitarWood = new THREE.MeshStandardMaterial({ color: 0xdeb887, flatShading: true });   // burlywood 淺木色
const guitarDark = new THREE.MeshStandardMaterial({ color: 0x8b6914, flatShading: true });   // 偏深木色給琴頸

// 琴身：圓角長方形，用 ExtrudeGeometry 拉成有厚度的方塊
const bodyShape = new THREE.Shape();
const bW = 0.4;   // 半寬
const bH = 0.58;  // 半高
const bR = 0.12;  // 圓角半徑
bodyShape.moveTo(-bW + bR, -bH);
bodyShape.lineTo(bW - bR, -bH);
bodyShape.quadraticCurveTo(bW, -bH, bW, -bH + bR);
bodyShape.lineTo(bW, bH - bR);
bodyShape.quadraticCurveTo(bW, bH, bW - bR, bH);
bodyShape.lineTo(-bW + bR, bH);
bodyShape.quadraticCurveTo(-bW, bH, -bW, bH - bR);
bodyShape.lineTo(-bW, -bH + bR);
bodyShape.quadraticCurveTo(-bW, -bH, -bW + bR, -bH);
const guitarBodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: 0.22,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.035,
    bevelSegments: 3,
    curveSegments: 8
});
guitarBodyGeo.translate(0, 0, -0.11); // 沿 z 置中
const guitarBody = new THREE.Mesh(guitarBodyGeo, guitarWood);
guitarBody.castShadow = true;
guitar.add(guitarBody);

// 共鳴孔 (深色圓盤貼在琴身正面)
const holeGeo = new THREE.CircleGeometry(0.13, 16);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x2d1810 });
const hole = new THREE.Mesh(holeGeo, holeMat);
hole.position.set(0, -0.1, 0.16);
guitar.add(hole);

// 琴頸
const neckGeo = new THREE.BoxGeometry(0.13, 0.85, 0.08);
const neck = new THREE.Mesh(neckGeo, guitarDark);
neck.position.y = 1.0;
neck.castShadow = true;
guitar.add(neck);

// 琴頭
const headstockGeo = new THREE.BoxGeometry(0.24, 0.22, 0.09);
const headstock = new THREE.Mesh(headstockGeo, guitarWood);
headstock.position.y = 1.53;
headstock.castShadow = true;
guitar.add(headstock);

// 4 條琴弦
const stringMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
for (let gi = 0; gi < 4; gi++) {
    const sGeo = new THREE.CylinderGeometry(0.006, 0.006, 2.0, 4);
    const sm = new THREE.Mesh(sGeo, stringMat);
    sm.position.set((gi - 1.5) * 0.028, 0.6, 0.155);
    guitar.add(sm);
}

// 初始隱藏，彈奏時用 animate 內計算的世界座標擺在黑貓正前方
guitar.visible = false;
scene.add(guitar);

// ========================
// 白色音符共用 canvas texture
// ========================
const noteCanvas = document.createElement('canvas');
noteCanvas.width = 64;
noteCanvas.height = 64;
const noteCtx = noteCanvas.getContext('2d');
noteCtx.fillStyle = '#4a9eff'; // 鮮明的天藍色
noteCtx.font = 'bold 52px "Segoe UI Symbol", "Segoe UI Emoji", Arial, sans-serif';
noteCtx.textAlign = 'center';
noteCtx.textBaseline = 'middle';
noteCtx.fillText('♫', 32, 36); // ♫ 連音符 (beamed eighth notes)
const noteTexture = new THREE.CanvasTexture(noteCanvas);

const musicNotes = [];
let noteSpawnTimer = 0;             // 累積幀數
const noteSpawnInterval = 80;       // 每 80 幀 (~1.33 秒) 噴一顆，數量減半
function spawnMusicNote(x, y, z) {
    const mat = new THREE.SpriteMaterial({ map: noteTexture, transparent: true, opacity: 1.0 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.8, 0.8, 1); // 大小 ×2 (原 0.4)
    sprite.position.set(x, y, z);
    sprite.userData = {
        vx: (Math.random() - 0.5) * 0.006,    // 速度 / 3 (原 0.018)
        vy: 0.006 + Math.random() * 0.004,    // 速度 / 3 (原 0.018+0.012)
        vz: (Math.random() - 0.5) * 0.006,
        life: 1.0
    };
    scene.add(sprite);
    musicNotes.push(sprite);
}

// 黑貓彈奏狀態 (改成在黑貓旁邊跳一下落地觸發)
const blackCatState = {
    playing: false,
    t: 0,           // 0=正常蹲姿，1=立起彈吉他
    baseY: 0        // 之後填入地形高度
};
blackCatState.baseY = blackCat.position.y;
const blackCatStandRotX = -Math.PI / 3;   // 立起時往後仰 60 度
const blackCatStandLift = 0.31 * 0.9;     // 抬高補償 (含 0.9 scale)
const blackCatTriggerRadius = 5.0;        // 主貓多近落地才算觸發 (3.0 → 5.0 範圍變大)

// 生日歌音樂 (happy_birthday_meow.mp3 跟 app.js 在同一個資料夾)
const bgMusic = new Audio('happy_birthday_meow.mp3');
bgMusic.loop = true;
bgMusic.volume = 0.35; // 0.7 → 0.35，音量縮小一半

// ========================
// 貓咪落地產生 Low Poly 方塊白煙粒子系統
// ========================
const landingSmokes = [];
// 共用同一份 geometry，顆粒放大兩倍 (0.22 → 0.44)
const smokeSharedGeo = new THREE.BoxGeometry(0.44, 0.44, 0.44);
function createLandingSmoke() {
    const numParticles = 8; // 顆粒數量減半 (16 → 8)
    for (let i = 0; i < numParticles; i++) {
        // 實心白 (不透明)
        const smokeMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            flatShading: true
        });
        const puff = new THREE.Mesh(smokeSharedGeo, smokeMat);
        puff.position.set(cat.position.x, cat.position.y, cat.position.z);
        // 散開距離縮回一半，煙霧不會飛太遠 (顆粒本身仍是 2x 大)
        puff.userData = {
            velocity: new THREE.Vector3(
                (random() - 0.5) * 0.18,
                random() * 0.08 + 0.04,
                (random() - 0.5) * 0.18
            ),
            scaleSpeed: 0.95, // 縮小變慢，配合 2 倍生存時間最終收成小點
            life: 1.0
        };
        scene.add(puff);
        landingSmokes.push(puff);
    }
}

// (橘色推球已移除)

// ========================
// WASD 與跳躍 控制邏輯
// ========================
const keys = { w: false, a: false, s: false, d: false };
let isJumping = false;
let velocityY = 0;
let catJumpY = 0;

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;

    // 處理空白鍵跳躍 (初速降為 0.144 = 0.18 × 0.8，搭配下方較小重力讓整個跳躍延長 25% 時間)
    if (e.key === ' ' && !isJumping) {
        isJumping = true;
        velocityY = 0.144;
    }

});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});

// ========================
// 可拖移白點搖桿 (虛擬 joystick)
// 拖白點 → 貓朝該方向走；放手 → 白點彈回原位
// 沒拖動就放手 (純點擊) → 跳躍
// ========================
const mobileControls = document.createElement('div');
mobileControls.id = 'mobile-controls';
mobileControls.innerHTML = `
    <div id="dpad-ring"></div>
    <div id="dpad-knob"></div>
`;
document.body.appendChild(mobileControls);

const mctrlStyle = document.createElement('style');
mctrlStyle.textContent = `
    #mobile-controls {
        position: fixed;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%);
        width: 120px;
        height: 120px;
        z-index: 50;
        pointer-events: none;
    }
    #dpad-ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: transparent;
        border: none;
        pointer-events: none;
    }
    #dpad-knob {
        position: absolute;
        width: 38px;
        height: 38px;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.92);
        border: 2px solid rgba(255, 255, 255, 1);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        cursor: grab;
        pointer-events: auto;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.1s, box-shadow 0.1s;
    }
    #dpad-knob:active {
        cursor: grabbing;
        background: rgba(255, 255, 255, 1);
        box-shadow: 0 2px 14px rgba(0, 0, 0, 0.45);
    }
    /* 手機 RWD：搖桿放大 1.5 倍 + 距底部 2 倍距離 (28px → 56px) */
    @media (max-width: 768px) {
        #mobile-controls {
            bottom: 56px;
            width: 180px;
            height: 180px;
        }
        #dpad-knob {
            width: 57px;
            height: 57px;
        }
    }
`;
document.head.appendChild(mctrlStyle);

const dpadKnob = document.getElementById('dpad-knob');
// 手機尺寸偵測：搖桿活動半徑 / 死區 / 拖動門檻都跟著 ×1.5
const isMobileViewport = window.innerWidth <= 768;
const knobMaxRadius = isMobileViewport ? 63 : 42; // 42 × 1.5 = 63
const knobDeadZone = isMobileViewport ? 12 : 8;   // 8 × 1.5 = 12
const dragThresholdSq = isMobileViewport ? 144 : 64; // 12² 對應 8²

let knobActive = false;
let knobStartX = 0, knobStartY = 0;
let knobHasDragged = false;

function knobReset() {
    dpadKnob.style.transform = 'translate(-50%, -50%)';
    keys.w = keys.a = keys.s = keys.d = false;
}

function knobUpdate(clientX, clientY) {
    if (!knobActive) return;
    const rawDx = clientX - knobStartX;
    const rawDy = clientY - knobStartY;

    if (!knobHasDragged && (rawDx * rawDx + rawDy * rawDy) > dragThresholdSq) {
        knobHasDragged = true;
    }

    // 把位移夾在最大半徑內
    const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
    const k = dist > knobMaxRadius ? knobMaxRadius / dist : 1;
    const dx = rawDx * k;
    const dy = rawDy * k;

    // 白點視覺位置 = 中心 + 位移
    dpadKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // 依拖動向量觸發 WASD (兩軸獨立可同時，自然斜走)
    if (knobHasDragged) {
        keys.d = dx > knobDeadZone;
        keys.a = dx < -knobDeadZone;
        keys.s = dy > knobDeadZone;
        keys.w = dy < -knobDeadZone;
    }
}

function knobStart(clientX, clientY) {
    knobActive = true;
    knobHasDragged = false;
    // 記住白點的「中心點世界座標」做位移基準
    const r = dpadKnob.getBoundingClientRect();
    knobStartX = r.left + r.width / 2;
    knobStartY = r.top + r.height / 2;
}

function knobEnd() {
    if (!knobActive) return;
    knobActive = false;
    // 沒拖動 = 純點擊 → 跳躍
    if (!knobHasDragged && !isJumping) {
        isJumping = true;
        velocityY = 0.144;
    }
    knobReset();
}

// 滑鼠
dpadKnob.addEventListener('mousedown', (e) => {
    e.preventDefault();
    knobStart(e.clientX, e.clientY);
    const onMove = (ev) => knobUpdate(ev.clientX, ev.clientY);
    const onUp = () => {
        knobEnd();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

// 觸控 (手機)
dpadKnob.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) knobStart(t.clientX, t.clientY);
}, { passive: false });
dpadKnob.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) knobUpdate(t.clientX, t.clientY);
}, { passive: false });
dpadKnob.addEventListener('touchend', (e) => {
    e.preventDefault();
    knobEnd();
}, { passive: false });
dpadKnob.addEventListener('touchcancel', knobEnd);
dpadKnob.addEventListener('contextmenu', (e) => e.preventDefault());

const speed = 0.08; // 走路速度減 20% (原 0.1)
const catRotationSpeed = 0.1;
let catRotationAngle = 0; // 朝向角度

// 攝影機相對方位於貓咪的角度與距離 (整體距離縮短 20%，更靠近貓咪)
const cameraOffset = new THREE.Vector3(0, 6.4, 11.2);

// 射線投射器，用於偵測地形高度
const raycaster = new THREE.Raycaster();
const downDirection = new THREE.Vector3(0, -1, 0);

// ========================
// 遊戲迴圈 (Animation Loop)
// ========================
// shadow map 不必每幀更新，每 6 幀觸發一次 (60fps 下每秒 10 次，足夠平滑)
let shadowUpdateCounter = 0;
const shadowUpdateInterval = 6;

function animate() {
    requestAnimationFrame(animate);

    // 定期更新 shadow map (大幅降低每幀工作量)
    shadowUpdateCounter++;
    if (shadowUpdateCounter % shadowUpdateInterval === 0) {
        renderer.shadowMap.needsUpdate = true;
    }

    // 貓咪移動向量
    let moveX = 0;
    let moveZ = 0;

    if (keys.w) moveZ -= 1;
    if (keys.s) moveZ += 1;
    if (keys.a) moveX -= 1;
    if (keys.d) moveX += 1;

    let bounceOffset = 0;

    // 實際移動與旋轉處理
    if (moveX !== 0 || moveZ !== 0) {
        // 正規化向量防止斜角移動過快
        const length = Math.sqrt(moveX*moveX + moveZ*moveZ);
        moveX /= length;
        moveZ /= length;

        let nextX = cat.position.x + moveX * speed;
        let nextZ = cat.position.z + moveZ * speed;

        // ========================
        // 樹木 + 桌子 + 黑貓與貓咪之間的碰撞偵測
        // ========================
        const canMove = (x, z) => !checkTreeCollision(x, z, 2.0) && !isNearTable(x, z) && !isNearBlackCat(x, z) && !isInsideStage(x, z) && !isNearAnyStageCat(x, z);
        if (canMove(nextX, nextZ)) {
            cat.position.x = nextX;
            cat.position.z = nextZ;
        } else {
            // 如果同時走有碰撞，讓玩家可以滑過牆壁 (X與Z分開偵測)
            if (canMove(nextX, cat.position.z)) {
                cat.position.x = nextX;
            }
            if (canMove(cat.position.x, nextZ)) {
                cat.position.z = nextZ;
            }
        }

        // 計算目標面向角度 (Math.atan2 參數為 x, z 可以算出平面的角度)
        const targetAngle = Math.atan2(moveX, moveZ);
        
        // 貓咪平滑轉向
        // 將角度稍微做補間(Lerp)讓轉向不會太死硬
        let diff = targetAngle - catRotationAngle;
        // 正規化角度差異在 -PI 到 PI 之間
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        
        catRotationAngle += diff * catRotationSpeed;
        cat.rotation.y = catRotationAngle;

        // 簡單的走路動畫(上下浮動)
        const time = Date.now() * 0.01;
        bounceOffset = Math.abs(Math.sin(time)) * 0.1;
    }

    // 地圖邊界限制 (草地大小變大為 65，樹牆從 31 開始，限制在 -29 到 29 之間避免跑出地圖)
    const mapLimit = 29;
    if (cat.position.x > mapLimit) cat.position.x = mapLimit;
    if (cat.position.x < -mapLimit) cat.position.x = -mapLimit;
    if (cat.position.z > mapLimit) cat.position.z = mapLimit;
    if (cat.position.z < -mapLimit) cat.position.z = -mapLimit;

    // 處理跳躍邏輯
    if (isJumping) {
        catJumpY += velocityY;
        velocityY -= 0.0064; // 重力 0.0064 = 0.01 × 0.64，讓上升與落地都慢 20% 但跳躍高度不變
        if (catJumpY <= 0) {
            catJumpY = 0;
            isJumping = false;
            velocityY = 0;
            // 落地瞬間產生白色 Low Poly 煙霧
            createLandingSmoke();

            // 落地時若在黑貓附近，切換黑貓彈吉他狀態 (取代原本的 E 鍵)
            const dxBcLand = cat.position.x - blackCatCenter.x;
            const dzBcLand = cat.position.z - blackCatCenter.z;
            if (Math.sqrt(dxBcLand * dxBcLand + dzBcLand * dzBcLand) < blackCatTriggerRadius) {
                blackCatState.playing = !blackCatState.playing;
                if (blackCatState.playing) {
                    bgMusic.currentTime = 0;
                    bgMusic.play().catch(err => console.log('音樂播放失敗:', err));
                } else {
                    bgMusic.pause();
                    bgMusic.currentTime = 0;
                }
            }

            // 落地時若在舞台附近，切換舞台貓跳舞狀態 + BTS 音樂
            const dxSc = cat.position.x - stageX;
            const dzSc = cat.position.z - stageZ;
            if (Math.sqrt(dxSc * dxSc + dzSc * dzSc) < stageCatTriggerRadius) {
                stageCatState.playing = !stageCatState.playing;
                if (stageCatState.playing) {
                    btsMusic.currentTime = 5;
                    btsMusic.play().catch(err => console.log('BTS 音樂播放失敗:', err));
                } else {
                    btsMusic.pause();
                    btsMusic.currentTime = 5;
                }
            }
        }
    }

    // 處理煙霧與火焰動畫 (純白實心，靠縮放消失而不是淡出)
    for (let i = landingSmokes.length - 1; i >= 0; i--) {
        const puff = landingSmokes[i];
        puff.position.add(puff.userData.velocity);
        puff.scale.multiplyScalar(puff.userData.scaleSpeed);
        puff.userData.life -= 0.025; // 生存時間 ×2 (原 0.05，每幀扣 0.025 等於 40 幀才消失)

        if (puff.userData.life <= 0) {
            scene.remove(puff);
            // 釋放 material (geometry 是共用的，不可 dispose)
            puff.material.dispose();
            landingSmokes.splice(i, 1);
        }
    }

    const flameTime = Date.now() * 0.01;
    flames.forEach((flame, index) => {
        // 燃燒的隨機縮放閃爍
        flame.scale.set(
            1 + Math.sin(flameTime + index) * 0.2, 
            1 + Math.abs(Math.sin(flameTime * 1.5 + index)) * 0.3, 
            1 + Math.cos(flameTime + index) * 0.2
        );
    });

    // 處理空氣飄浮粒子
    const particlePositions = particles.geometry.attributes.position.array;
    for (let i = 1; i < particleCount * 3; i += 3) {
        particlePositions[i] += 0.01; // 緩慢上升
        if (particlePositions[i] > 10) particlePositions[i] = 0; // 高於10重置回地上
    }
    particles.geometry.attributes.position.needsUpdate = true;
    
    // (橘色推球與相關物理已移除)

    // ========================
    // 黑貓彈吉他動畫 + 音符飄動
    // ========================
    const targetBcT = blackCatState.playing ? 1 : 0;
    blackCatState.t += (targetBcT - blackCatState.t) * 0.1; // 平滑插值
    const bcT = blackCatState.t;

    // 立身：rotation.x 從 0 漸變到 -π/3，位置同步抬高，避免屁股穿地
    blackCat.rotation.x = blackCatStandRotX * bcT;
    let bcSway = 0;
    if (blackCatState.playing && bcT > 0.85) {
        // 完全立起後身體上下微微搖晃 (頻率約 0.8 Hz，幅度 0.05)
        bcSway = Math.sin(Date.now() * 0.005) * 0.05;
    }
    blackCat.position.y = blackCatState.baseY + blackCatStandLift * bcT + bcSway;

    // 吉他位置：scene-level，沿黑貓朝向放在身前 0.7 單位處 (更貼近胸口)
    if (bcT > 0.3) {
        guitar.visible = true;
        const yRot = -Math.PI / 5; // 黑貓的 Y 朝向
        const facingX = Math.sin(yRot);
        const facingZ = Math.cos(yRot);
        const offsetForward = 0.7; // 0.95 → 0.7，吉他離黑貓更近
        const chestHeight = 0.7;
        guitar.position.x = blackCatX + facingX * offsetForward;
        guitar.position.y = blackCatState.baseY + chestHeight + bcSway;
        guitar.position.z = blackCatZ + facingZ * offsetForward;
        guitar.rotation.y = yRot;        // 跟貓同方向
        guitar.rotation.x = 0.15;        // 稍微往後仰
        guitar.rotation.z = -0.25;       // 琴頸往一邊歪，像被抱著
    } else {
        guitar.visible = false;
    }

    // 噴出音符：每 noteSpawnInterval 幀一顆，跟前一顆共存往上飄到完整高度才消失
    if (blackCatState.playing && bcT > 0.85) {
        noteSpawnTimer++;
        if (noteSpawnTimer >= noteSpawnInterval) {
            noteSpawnTimer = 0;
            spawnMusicNote(
                guitar.position.x + (Math.random() - 0.5) * 0.15,
                guitar.position.y + 0.1,
                guitar.position.z + (Math.random() - 0.5) * 0.15
            );
        }
    } else {
        noteSpawnTimer = noteSpawnInterval;
    }

    // ========================
    // 舞台 7 隻貓跳舞：站立 + X/Y/Z 三軸搖擺 + 身體扭動 (沒音符)
    // ========================
    const targetScT = stageCatState.playing ? 1 : 0;
    stageCatState.t += (targetScT - stageCatState.t) * 0.1;
    const scT = stageCatState.t;
    const danceTime = Date.now() * 0.004;
    for (let si = 0; si < stageCats.length; si++) {
        const sc = stageCats[si];
        // 跳舞時各方向都有小幅擺動，phase 錯開讓 7 隻不同步
        const isFullyDancing = stageCatState.playing && scT > 0.85 ? 1 : 0;
        const bobY    = Math.sin(danceTime * 1.4 + sc.phase) * 0.18 * isFullyDancing; // 上下跳動 (主節奏)
        const swayX   = Math.sin(danceTime * 0.8 + sc.phase) * 0.22 * isFullyDancing; // 左右搖
        const swayZ   = Math.sin(danceTime * 0.6 + sc.phase + 1.2) * 0.14 * isFullyDancing; // 前後晃
        const wiggleY = Math.sin(danceTime * 1.1 + sc.phase + 0.5) * 0.18 * isFullyDancing; // 身體左右扭轉
        sc.mesh.rotation.x = stageCatStandRotX * scT;
        sc.mesh.rotation.y = sc.baseRotY + wiggleY;
        sc.mesh.position.x = sc.baseX + swayX;
        sc.mesh.position.y = sc.baseY + stageCatStandLift * scT + bobY;
        sc.mesh.position.z = sc.baseZ + swayZ;
    }

    // 更新所有飄動中的音符
    for (let mi = musicNotes.length - 1; mi >= 0; mi--) {
        const n = musicNotes[mi];
        n.position.x += n.userData.vx;
        n.position.y += n.userData.vy;
        n.position.z += n.userData.vz;
        n.userData.life -= 0.002;
        if (n.userData.life <= 0) {
            scene.remove(n);
            n.material.dispose();
            musicNotes.splice(mi, 1);
        }
    }

    // 舞台兩側 + BTS 字母間共 4 處火花噴泉 (只在跳舞時噴；停止後仍更新場上的，讓它們自然飄完淡出)
    if (stageCatState.playing && scT > 0.85) {
        sparkSpawnCounter++;
        if (sparkSpawnCounter % 2 === 0) {
            spawnSpark(sparkLeftX, sparkLeftY, stageZ);
            spawnSpark(sparkRightX, sparkRightY, stageZ);
            spawnSpark(sparkBTX, sparkBTY, btsZ);
            spawnSpark(sparkTSX, sparkTSY, btsZ);
        }
    }
    for (let pi = sparks.length - 1; pi >= 0; pi--) {
        const sp = sparks[pi];
        sp.position.x += sp.userData.vx;
        sp.position.y += sp.userData.vy;
        sp.position.z += sp.userData.vz;
        sp.userData.vy -= 0.012; // 重力把火花往下拉
        sp.userData.life -= 0.018;
        sp.material.opacity = Math.max(0, sp.userData.life);
        sp.scale.multiplyScalar(0.985); // 逐漸縮小
        if (sp.userData.life <= 0) {
            scene.remove(sp);
            sp.material.dispose();
            sparks.splice(pi, 1);
        }
    }

    // 處理 KITTY 氣球微微隨風飄動
    const balloonTime = Date.now() * 0.001;
    for (let i = 0; i < balloons.length; i++) {
        const b = balloons[i];
        b.mesh.position.y = b.baseY + Math.sin(balloonTime * 1.2 + b.phase) * 0.08;
        b.mesh.position.x = b.baseX + Math.sin(balloonTime * 0.8 + b.phase + 1.5) * 0.04;
        b.mesh.rotation.z = Math.sin(balloonTime * 0.7 + b.phase) * 0.05;
    }

    // 處理植物隨風擺動
    const windTime = Date.now() * 0.002;
    for (let i = 0; i < swayObjects.length; i++) {
        const obj = swayObjects[i];
        obj.rotation.x = obj.userData.initRotX + Math.sin(windTime + obj.userData.swayOffset + obj.position.x) * 0.08;
        obj.rotation.z = obj.userData.initRotZ + Math.cos(windTime + obj.userData.swayOffset + obj.position.z) * 0.08;
    }

    // 處理蝴蝶飛舞
    const bfTime = Date.now() * 0.001;
    for (let i = 0; i < butterflies.length; i++) {
        const bf = butterflies[i];
        if (bf.mesh.position.distanceTo(bf.target) < 1.0) {
            bf.target.set((Math.random() - 0.5) * 40, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 40);
        }
        const dir = new THREE.Vector3().subVectors(bf.target, bf.mesh.position).normalize();
        bf.mesh.position.add(dir.multiplyScalar(bf.speed));
        const targetAngleBf = Math.atan2(dir.x, dir.z);
        let diffBf = targetAngleBf - bf.mesh.rotation.y;
        while (diffBf < -Math.PI) diffBf += Math.PI * 2;
        while (diffBf > Math.PI) diffBf -= Math.PI * 2;
        bf.mesh.rotation.y += diffBf * 0.05;
        bf.mesh.position.y += Math.sin(bfTime * 5 + bf.timeOffset) * 0.02;
        const flapAngle = Math.sin(bfTime * 20 * bf.flapSpeed + bf.timeOffset) * 1.2;
        bf.lWing.rotation.z = Math.abs(flapAngle);
        bf.rWing.rotation.z = -Math.abs(flapAngle);
    }

    raycaster.set(new THREE.Vector3(cat.position.x, 50, cat.position.z), downDirection);
    const intersects = raycaster.intersectObject(ground);
    let groundHeight = 0;
    if (intersects.length > 0) {
        groundHeight = intersects[0].point.y;
    }
    cat.position.y = groundHeight + bounceOffset + catJumpY;

    const idealCameraPos = new THREE.Vector3().copy(cat.position).add(cameraOffset);
    camera.position.lerp(idealCameraPos, 0.1);
    camera.lookAt(cat.position);

    renderer.render(scene, camera);
}


camera.position.copy(new THREE.Vector3().copy(cat.position).add(cameraOffset));
camera.lookAt(cat.position);
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.needsUpdate = true;
});
