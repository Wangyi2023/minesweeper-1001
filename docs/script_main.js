// script_main.js - 16.08.2025

// < Part 0 - Define Global-Variables >

/*
X 为矩阵的行数，Y 为列数，N 为雷的数量，DATA 为存储矩阵信息的高密度容器 Uint8Array
具体存储方式为，将存储 Cell 的二维矩阵扁平化为一维数组，将单个 Cell 的各项信息分别存储在 8 位中的各个部分，具体存储方式在下面表格中
这种存储 DATA 的方式是优化到极限的，在高频访问时对缓存极其友好，并且在更改内部数据的时候全部使用位运算，速递极快
而 CELL_ELEMENTS 只用于存储 cell_element 的索引，它无法被 Uint8Array 压缩，只能用普通数组存储
它的作用是快速寻找到需要渲染的 cell，而不必频繁调用 querySelector
 */
let X, Y, N, DATA, CELL_ELEMENTS;
/*
数据通过下面的 Mask 被压缩，通过位运算可直接获取它们的各项信息，由于 number 这一项信息的数据类型为 int，我选择把它放到最低位，
这样只需掩码位运算就可获取到 int 以及更改它的值，如果放在高位，需要额外的左移和右移运算，并且在游戏中它的值为 0-8，因此只需要 4 bit
的位置即可存储它的值
而其它元素均为 boolean，可以随意放置，其中 internal-mark 是内部标记，用于内部算法计算，与 mark 外部标记不同，外部标记由玩家操控，
用于辅助玩家完成游戏，也正是因此外部标记不需要存储到 DATA 中，而是直接存在页面中对应的 cell-div-classList 中
---------------------------------------------------------------------
| internal-mark   | visited   | covered   | mine   | number (0-8)   |
| bit 7           | bit 6     | bit 5     | bit 4  | bit 0-3        |
---------------------------------------------------------------------
可通过位掩码提取各项信息，如下
DATA[x * Y + y] & NUMBER_MASK     <-> number on the cell (x, y) is n
DATA[x * Y + y] & MINE_MAS        <-> cell (x, y) is mine
DATA[x * Y + y] & COVERED_MASK    <-> cell (x, y) is covered
 */
const Nr_ = 0b00001111;
const Mi_ = 0b00010000;
const Cv_ = 0b00100000;
const Vs_ = 0b01000000;
const Mk_ = 0b10000000;

/*
游戏 ID 的作用是在一些延迟操作中，若操作未结束时玩家强行重设棋盘，尚未完成的延时操作会在重设后由于 ID 的改变被迫中断
 */
let ID = 0;
/*
Stored_Hash 为激活算法的密码，在测试阶段和一些特殊情况下，例如棋盘过大导致算法卡顿而引起游戏体验变差时，我会关闭复杂算法，
此时如果需要强行激活算法需要用到此密码
 */
const STORED_HASH = '6db07d30';
/*
DX 和 DY 的作用是快速获取和遍历一个坐标的所有周围坐标，为满足特殊需求比如有时只需要分析上下左右的方向，我将上下左右的坐标
放置于前4位，以方便及时截断，整体遍历顺序为顺时针方向，在延迟打开大量坐标时视觉效果很好。
 */

const Test = {
    1: { Mines: [[0, 0], [2, 0], [2, 1]] },
    2: { Mines: [[0, 0], [2, 0], [2, 1], [3, 0], [5, 0], [5, 1], [7, 0]] },
    3: { Mines: [[0, 0], [0, 1], [2, 0], [2, 1]] },
    4: { Mines: [[0, 1], [1, 0], [2, 1], [3, 0], [3, 1]] },
    5: { Mines: [[0, 0], [2, 0], [3, 0], [5, 0], [5, 1]] },
    6: { Mines: [[0, 0], [1, 1], [2, 2]] },
    7: { Mines: [[0, 1], [1, 0], [2, 2]] },
    8: { Mines: [[0, 0], [0, 1], [1, 0], [2, 2]] },
}

const DX = [-1, 0, 1, 0, -1, 1, 1, -1];
const DY = [0, 1, 0, -1, 1, 1, -1, -1];

let current_difficulty = 'high';

const CELL_SIZE = 24;
const FONT_SIZE = 16;
const ALGORITHM_LIMIT = 480;
const DELAY = 5;
const TIMEOUT = 4500;

let first_step = true;
let game_over = false;
let is_solving = false;

let start_time = null;
let timer_interval = null;
let last_notice_time = 0;

let algorithm_enabled = false;
let cursor_enabled = false;

let counter_revealed, counter_marked;
let cursor_x, cursor_y, cursor_path;

let module_collection = [];
let bitmap_size;
let solutions;
let solvable = false;



// < Part 1 - Game Logic >

// Todo 1.1 - Init
function start({test_id} = {}) {
    ID++;

    if (test_id) {
        const params = Test[test_id];
        X = 8;
        Y = 8;
        N = params.Mines.length;
        first_step = false;
        init_board_data();

        for (const [x, y] of params.Mines) {
            add_mine(x * Y + y);
        }

        setTimeout(() => {select_cell(7)}, 50);
    } else {
        const params = get_difficulty_params(current_difficulty);
        X = params.X;
        Y = params.Y;
        N = params.N;
        first_step = true;
        init_board_data();
    }

    generate_game_field();
    render_border();

    algorithm_enabled = X * Y <= ALGORITHM_LIMIT;
    game_over = false;
    counter_revealed = 0;
    counter_marked = 0;
    cursor_x = 4;
    cursor_y = 4;
    cursor_path = cursor_x * Y + cursor_y;

    module_collection = [];
    bitmap_size = Math.ceil(X * Y / 32) + 1;
    solutions = new Uint32Array(bitmap_size);
    solvable = false;
    is_solving = false;

    start_time = null;
    clearInterval(timer_interval);

    init_information_box();
    update_solvability_info();
    updateCursor();
}
function init_board_data() {
    /*
    init_board_data 函数的作用仅仅是初始化棋盘，不添加雷，目的是在玩家选择第一个格子后才通过下面的 set_mines 函数
    确认雷的位置,实际上这个目的也可以通过重设棋盘来完成，但是它的算法量与此思路相比较大，同样的也可以在玩家选择第一个格子后
    不断 restart 整个游戏，直到玩家选择的位置不是雷为止，这样的代码非常简单但是浪费了很多算力
     */
    DATA = new Uint8Array(X * Y).fill(Cv_);
}
function set_mines(target_number_of_mines, position_first_click) {
    /*
    这个函数的作用是随机摆放雷的位置，并且在输入一个赦免坐标的情况下，确保雷不会摆放到此坐标及其相邻坐标，具体思路如下
    创建一个 Uint32Array 用作打乱后的指针列表，将赦免的坐标依次交换到数组最后，然后打乱除赦免坐标的部分，最后取前面
    的坐标将其全部设为雷
    注意！这里有一些优化方式，首先所谓的交换实际上是直接把后面的数字取出然后覆盖到赦免坐标的 index 上，因为最后的几个坐标是
    需要完全忽视的，也就是 index >= size 的坐标，它们的值是无意义的，更改 size 即可将其视为无效数据
    其次打乱的时候真正被有效打乱的是前 n 个最后需要被放置雷的坐标，其中第 i 个坐标我们会取任意一个在 [i, size) 之间的坐标
    与之交换，这个操作截至到 size 就结束了，后面的数据只会与更靠后的数据交换，所以打乱没有意义
    最后我们取前 n 个坐标将其全部设为雷，并同步更新每一个雷周围的元素的 number，棋盘的创建到此就彻底结束了
     */
    const fx = (position_first_click / Y) | 0;
    const fy = position_first_click - fx * Y;

    let size = X * Y;
    const array = new Uint32Array(size);
    for (let i = 0; i < size; i++) array[i] = i;

    array[position_first_click] = --size;
    for (let n = 0; n < 8; n++) {
        const x = fx + DX[n];
        const y = fy + DY[n];
        if (x >= 0 && x < X && y >= 0 && y < Y) {
            array[x * Y + y] = --size;
        }
    }

    for (let i = 0; i < target_number_of_mines; i++) {
        const r = i + ((Math.random() * (size - i)) | 0);
        const temp = array[i];
        array[i] = array[r];
        array[r] = temp;
    }

    for (let i = 0; i < target_number_of_mines; i++) {
        const ri = array[i];
        DATA[ri] |= Mi_;

        const rx = (ri / Y) | 0;
        const ry = ri - rx * Y;
        for (let n = 0; n < 8; n++) {
            const x = rx + DX[n];
            const y = ry + DY[n];
            if (x >= 0 && x < X && y >= 0 && y < Y) {
                DATA[x * Y + y]++;
            }
        }
    }
}
function get_difficulty_params(difficulty) {
    switch (difficulty) {
        case 'low':
            return { X: 9, Y: 9, N: 10 };
        case 'medium':
            return { X: 16, Y: 16, N: 40 };
        case 'high':
            return { X: 16, Y: 30, N: 99 };
        case 'fullscreen':
            const x = ((window.innerHeight - 100) / (CELL_SIZE + 2)) | 0;
            const y = ((window.innerWidth - 20) / (CELL_SIZE + 2)) | 0;
            const n = ( x * y * 0.20625) | 0;
            return { X: x, Y: y, N: n };
        default:
            return { X: 16, Y: 30, N: 99 };
    }
}
function hash_x(input) {
    const str = String(input);
    let hash = 0x811C9DC5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    hash ^= 0xDEADBEEF;
    hash = (hash >>> 16) ^ (hash & 0xFFFF);
    hash *= 0xCAFEBABE;
    hash ^= hash >>> 15;
    hash = Math.abs(hash);

    const A = 0x6D2B79F5;
    hash = (hash * A) >>> 0;
    hash ^= (hash >> 5) | (hash << 27);
    hash = (hash * 0x45D9F3B) >>> 0;

    return (hash >>> 0).toString(16).padStart(8, '0');
}
// Todo 1.2 - Edit Main Field
function select_cell(i) {
    if (game_over || !(DATA[i] & Cv_)) {
        return;
    }
    if (first_step) {
        set_mines(N, i);
        document.getElementById('status-info').textContent = 'In Progress';
        first_step = false;
        start_timer();
    }
    if (!solvable && (DATA[i] & Mi_) && algorithm_enabled) {
        reset_mines(i);
    }
    const target_element = CELL_ELEMENTS[i];
    if (target_element.classList.contains('marked')) {
        target_element.classList.remove('marked');
        counter_marked--;
        update_marks_info();
        return;
    }

    admin_reveal_cell(i, ID);
    if (!(DATA[i] & Nr_) && !(DATA[i] & Mi_)) {
        reveal_linked_cells_with_delay(i, ID);
    }
}
function reveal_linked_cells_with_delay(i, current_id) {
    /*
    这个函数的作用是，对于点击到数字为 0 的坐标，自动打开其相邻的所有坐标，为实现动画效果，这里给需要打开的坐标加上了延时
    而为了实现扩散效果，这里使用广度优先搜索 BFS 将需要打开的坐标加入优先队列
    为避免 queue 中重复元素过多，去重的方式为，将添加过的坐标直接在 DATA 中标记，恰好将 DATA 中每个坐标拥有的 8 位存储
    空间利用到极致
     */
    const queue = [i];
    DATA[i] |= Vs_;

    let index = 0;
    while (index < queue.length) {
        const j = queue[index];
        index++;
        if (DATA[j] & Nr_) {
            continue;
        }
        const jx = (j / Y) | 0;
        const jy = j - jx * Y;
        for (let n = 0; n < 8; n++) {
            const x = jx + DX[n];
            const y = jy + DY[n];
            if (x >= 0 && x < X && y >= 0 && y < Y) {
                const k = x * Y + y;
                if (!(DATA[k] & Vs_)) {
                    queue.push(k);
                    DATA[k] |= Vs_;
                }
            }
        }
    }
    let delay = 0;
    for (const j of queue) {
        setTimeout(() => {
            admin_reveal_cell(j, current_id);
        }, delay)
        delay += DELAY;
    }
}
function admin_reveal_cell(i, current_id) {
    /*
    注意！所有 reveal cell 的行为必须通过下面的 admin_reveal_cell 函数，因为所有检测游戏状态的机制
    和终止游戏的行为都从此函数开始，此处为分界线
    算法也统一在此处更新，因为每次棋盘内容有变动都需要及时更新 solvability
     */
    if (current_id !== ID) {
        return;
    }
    if (!(DATA[i] & Cv_)) {
        return;
    }
    const target_element = CELL_ELEMENTS[i];
    if (target_element.classList.contains('marked')) {
        target_element.classList.remove('marked');
        counter_marked--;
        update_marks_info();
    }
    DATA[i] &= ~Cv_;
    remove_cell_from_solutions(i);
    update_cell_display(i);
    counter_revealed++;
    if (!game_over & counter_revealed === X * Y - N) {
        terminate(true);
    }
    update_solvability_info();
}
function mark_cell(i) {
    /*
    未确保 DATA 占用内存尽可能小和集中，主算法性能尽可能高，标记 mark 这一性质不被存储在 DATA 里，标记操作（插旗）
    不会影响游戏数据，只会更改网页中对应的 div 的性质，尤其是因为每次操作都不可避免的调用 DOM，并且每次调用都只进行
    简单操作，因此没有任何必要在 JS 里存储标记信息
     */
    if (game_over || !(DATA[i] & Cv_)) {
        return;
    }
    const target_element = CELL_ELEMENTS[i];
    if (target_element.classList.contains('marked')) {
        target_element.classList.remove('marked');
        counter_marked--;
    } else {
        target_element.classList.add('marked');
        counter_marked++;
    }
    update_marks_info();
}
// Todo 1.3 - Algorithm Part 2
function send_hint() {
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('n_enabled');
        return;
    }

    const hint_list = [];
    if (first_step || !solvable) {
        for (let i = 0; i < X * Y; i++) {
            if (!(DATA[i] & Mi_) && (DATA[i] & Cv_)) {
                hint_list.push(i);
            }
        }
    } else {
        for (let i = 1; i < bitmap_size; i++) {
            let bits = solutions[i];
            if (bits === 0) continue;
            for (let bit_position = 0; bit_position < 32; bit_position++) {
                if (bits & (1 << bit_position)) {
                    const index = (i - 1) * 32 + bit_position;
                    hint_list.push(index);
                }
            }
        }
    }
    const ri = (Math.random() * hint_list.length) | 0;
    const r_hint = hint_list[ri];

    const target_element = CELL_ELEMENTS[r_hint];
    target_element.classList.add('hint');
    setTimeout(() => {
        target_element.classList.remove('hint');
    }, 2000);
}
function auto_mark() {
    if (game_over) {
        return;
    }
    init_module_collection();
    calculate_partially_module_collection(false);
    calculate_complete_module_collection();
    for (let i = 0; i < X * Y; i++) {
        if (DATA[i] & Mk_) {
            if (!CELL_ELEMENTS[i].classList.contains('marked')) {
                mark_cell(i);
            }
        }
    }
}
function solve() {
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('n_enabled');
        return;
    }
    if (first_step || !solvable) {
        const selections = [];
        for (let i = 0; i < X * Y; i++) {
            if (!(DATA[i] & Mi_) && (DATA[i] & Cv_)) {
                selections.push(i);
            }
        }
        const ri = (Math.random() * selections.length) | 0;
        select_cell(selections[ri]);
        update_solvability_info();
        return;
    }
    for (let i = 1; i < bitmap_size; i++) {
        let bits = solutions[i];
        if (bits === 0) continue;
        for (let bit_position = 0; bit_position < 32; bit_position++) {
            if (bits & (1 << bit_position)) {
                const index = (i - 1) * 32 + bit_position;
                select_cell(index);
            }
        }
    }
    update_solvability_info();
}
async function solve_all() {
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('n_enabled');
        return;
    }
    if (is_solving) {
        is_solving = false;
        return;
    }
    document.getElementById('solve-all-btn').classList.add('selected');
    is_solving = true;
    while (!game_over && is_solving) {
        solve();
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    document.getElementById('solve-all-btn').classList.remove('selected');
    is_solving = false;
}
// Todo 1.4 - Algorithm Part 1
function check_solvability() {
    /*
    在这个函数中我们会查看 solutions 列表的大小，这个列表非空意味着有解，如果当前还无解，就不断地进行计算，
    直到计算到 complete_module_collection 如果还没有解，那么说明当前局面是无法通过计算得出解的
    逐步计算的目的是减轻计算机负担，因为实际上在每次玩家打开方格的时候都需要检测 solvability，如果每次以计算出所有解
    为目的的话，会导致明显的延迟
     */
    solvable = false;
    for (let i = 1; i < solutions.length; i++) {
        if (solutions[i]) {
            solvable = true;
            return;
        }
    }
    init_module_collection();
    calculate_partially_module_collection();
    for (let i = 1; i < solutions.length; i++) {
        if (solutions[i]) {
            solvable = true;
            return;
        }
    }
    calculate_complete_module_collection();
    for (let i = 1; i < solutions.length; i++) {
        if (solutions[i]) {
            solvable = true;
            return;
        }
    }
}
function calculate_complete_module_collection() {
    /*
    在这个函数中我们会先标记所有的明确时雷的坐标，这个标记使用的是内部标记 internal mark，存储在 DATA 的 bit-7 位，
    这个函数运行的条件是，仅靠 init 的 game field collection 无法继续通过内部元素的迭代计算找到解，因此在这个函数中
    不必再迭代，而是需要手动添加一个全局 module，由于它在运算后会成为当前的所有 module 的并集的反面，因此我将其命名为
    inverse module
    这里我们不能将其加入到 module collection 然后继续进行内部迭代运算，因为会产生非常多的无效 module，最好的方式是像
    下面这样先将被标记为雷的坐标排除在 inverse 之外，然后不断取 module collection 中的元素出来尝试缩小 inverse 的
    范围，inverse 元素能提供的一个重要信息是将雷的总数加入分析列表，例如当棋盘上有 16 个不确定空格未打开，而目前只剩
    1 个雷的位置不确定，同时还有一个 module 是 2 选 1 的状态，那么我们确定这 16 个不确定空格除去 2 选 1 的 module
    都是安全的，这种思想在代码实现里的体现就是 inverses element
     */
    for (let i = 0; i < module_collection.length; i++) {
        const module = module_collection[i];
        if (module[0] > 0 && module[0] === count_bits(module)) {
            internal_mark_cells_in_module(module);
        }
    }
    let inverse_module = new Uint32Array(bitmap_size).fill(0);
    inverse_module[0] = N;
    for (let i = 0; i < X * Y; i++) {
        if (!(DATA[i] & Cv_)) {
            continue;
        }
        if (DATA[i] & Mk_) {
            inverse_module[0]--;
            continue;
        }
        add_cell_to_module(i, inverse_module);
    }

    let updated = true;
    for (const module of module_collection) {
        const created_module = process_module_pair(module, inverse_module);
        if (created_module.length === 1) {
            inverse_module = created_module[0];
            updated = true;
        }
    }
    if (inverse_module[0] === 0) {
        add_module_cells_to_solutions(inverse_module);
        safe_push_module(inverse_module);
        console.log(`3. inverse [0, ${count_bits(inverse_module)}]`);
    } else {
        for (const module of module_collection) {
            const created_module_list = process_module_pair(inverse_module, module);
            if (created_module_list.length === 3) {
                add_module_cells_to_solutions(created_module_list[0]);
                internal_mark_cells_in_module(created_module_list[1]);
            }
        }
    }
}
function calculate_partially_module_collection(return_enabled = true) {
    /*
    在这个函数中我们会先创建一个基础的 module_collection，遍历所有 module 让它们相互运算产生新的 module，这个函数的目的
    是发现解，因此一旦检测到某个 module number = 0，将会直接退出循环，并且将这个 module 中所有的坐标都加入 solutions 列表
    如果单圈循环没有创造出新的 module，也会直接退出
     */
    solutions = new Uint32Array(bitmap_size).fill(0);
    let saved_collection_size = 0;
    while (saved_collection_size < module_collection.length) {
        saved_collection_size = module_collection.length;
        for (let i = 0; i < module_collection.length; i++) {
            const module_i = module_collection[i];
            if (module_i[0] === 0) {
                add_module_cells_to_solutions(module_i);
                if (return_enabled) {
                    return;
                }
            }
            for (let j = i + 1; j < module_collection.length; j++) {
                const module_j = module_collection[j];
                const created_module_list = process_module_pair(module_i, module_j);
                for (const created_module of created_module_list) {
                    safe_push_module(created_module);
                }
            }
        }
    }
    console.log(`2. partially ${module_collection.length}`);
}
function init_module_collection() {
    /*
    在这个函数中我们会先将 module_collection 的信息清空，然后添加初始元素，具体方案如下
    我们会分析当前每个不覆盖的方格，先分析它周围的空格数量是否等于它自身的数字，如果相等将这个数字内部标记为 internal marked
    对于被内部标记的格子，在创建 module 的时候不会考虑到它，这样可以大幅减少 module-collection 的规模
    这个标记和创建 module 的过程实际上是同时进行的，我们会先创建一个 module，每当发现一个格子周围的 covered cells 中有一个
    internal mark，那么就让 module 中第 0 位的 number--，并不把它添加到 module 的位图中
    最后如果 module 中未确认的雷的数量恰好等于它的未打开的 cells 的数量，这整个 module 不仅不会被添加到 collection 里，还会
    将内部的所有 cells 标记上，以便在创建其它 module 的时候可以不需要再次辨别
     */
    module_collection = [];
    for (let index = 0; index < X * Y; index++) {
        if ((DATA[index] & Cv_)) {
            continue;
        }
        const module = new Uint32Array(bitmap_size).fill(0);
        module[0] = DATA[index] & Nr_;

        let is_empty_module = true;
        const idx = (index / Y) | 0;
        const idy = index - idx * Y;
        for (let n = 0; n < 8; n++) {
            const x = idx + DX[n];
            const y = idy + DY[n];
            if (x >= 0 && x < X && y >= 0 && y < Y) {
                const i = x * Y + y;
                if (!(DATA[i] & Cv_)) {
                    continue;
                }
                if (DATA[i] & Mk_) {
                    module[0]--;
                    continue;
                }
                add_cell_to_module(i, module);
                is_empty_module = false;
            }
        }
        const module_size = count_bits(module);
        if (module_size > 0) {
            if (module_size === module[0]) {
                internal_mark_cells_in_module(module);
            } else {
                safe_push_module(module);
            }
        }
    }
    console.log(`1. init ${module_collection.length.toString()}`);
}
// Todo 1.4 - Algorithm Part 1 - Module Collection
function safe_push_module(module_input) {
    for (const module of module_collection) {
        if (equals_module(module_input, module)) {
            return;
        }
    }
    module_collection.push(module_input);
}
function add_module_cells_to_solutions(module) {
    for (let index = 1; index < bitmap_size; index++) {
        solutions[index] |= module[index];
    }
}
function remove_cell_from_solutions(cell_index) {
    const array_position = ((cell_index / 32) | 0);
    const bit_position = cell_index - array_position * 32;
    solutions[array_position + 1] &= ~(1 << bit_position);
}
function add_cell_to_module(cell_index, module) {
    const array_position = ((cell_index / 32) | 0);
    const bit_position = cell_index - array_position * 32;
    module[array_position + 1] |= (1 << bit_position);
}
function internal_mark_cells_in_module(module) {
    for (let array_position = 1; array_position < bitmap_size; array_position++) {
        let bits = module[array_position];
        if (bits === 0) continue;
        for (let bit_position = 0; bit_position < 32; bit_position++) {
            if (bits & (1 << bit_position)) {
                const index = (array_position - 1) * 32 + bit_position;
                DATA[index] |= Mk_;
            }
        }
    }
}
function process_module_pair(a, b) {
    /*
    此函数会首先判断两个输入的 modules 的关系，并尝试生成所有可能的新 module
    它的优化在于一次遍历直接分析出两个元素的所有关系，然后按照关系耗时依次处理，比如 disjoint 和 equals 的情况最简单
    就会先被排除，排除后就不需要考虑 real subset 和 subset 的区别，而下一步排除了 subset 就不再需要判断
    real intersect 和 intersect 的区别
     */
    let equals = true;
    let a_subset_b = true;
    let b_subset_a = true;
    let intersect = false;

    for (let i = 1; i <= bitmap_size; i++) {
        const data_a = a[i];
        const data_b = b[i];

        if (data_a !== data_b) {
            equals = false;
        }
        if ((data_a & ~data_b) !== 0) {
            a_subset_b = false;
        }
        if ((data_b & ~data_a) !== 0) {
            b_subset_a = false;
        }
        if ((data_a & data_b) !== 0) {
            intersect = true;
        }
    }

    // Equals / Disjoint
    if (equals || !intersect) {
        return [];
    }
    // Real-Subset
    const a_0 = a[0], b_0 = b[0];
    if (a_subset_b) {
        const c = new Uint32Array(bitmap_size).fill(0);
        c[0] = b_0 - a_0;
        for (let i = 1; i <= bitmap_size; i++) {
            c[i] = b[i] & ~a[i];
        }
        return [c];
    }
    if (b_subset_a) {
        const c = new Uint32Array(bitmap_size).fill(0);
        c[0] = a_0 - b_0;
        for (let i = 1; i <= bitmap_size; i++) {
            c[i] = a[i] & ~b[i];
        }
        return [c];
    }

    // Real-Intersect
    const intersection = bitwise_intersection(a, b);
    const diff_ab = bitwise_difference(a, b);
    const diff_ba = bitwise_difference(b, a);

    const count_diff_ab = count_bits(diff_ab);
    const count_diff_ba = count_bits(diff_ba);

    if (b_0 - a_0 === count_diff_ba) {
        // module_1: a_diff_b, mines = 0
        const module_1 = new Uint32Array(bitmap_size).fill(0);
        module_1[0] = 0;
        for (let i = 1; i < bitmap_size; i++) {
            module_1[i] = diff_ab[i];
        }

        // module_2: b_diff_a, mines = count_diff_ba
        const module_2 = new Uint32Array(bitmap_size).fill(0);
        module_2[0] = count_diff_ba;
        for (let i = 1; i < bitmap_size; i++) {
            module_2[i] = diff_ba[i];
        }

        // module_3: intersection, mines = a[0]
        const module_3 = new Uint32Array(bitmap_size).fill(0);
        module_3[0] = a_0;
        for (let i = 1; i < bitmap_size; i++) {
            module_3[i] = intersection[i];
        }

        return [module_1, module_2, module_3];
    }
    if (a_0 - b_0 === count_diff_ab) {
        // module_1: b_diff_a, mines = 0
        const module_1 = new Uint32Array(bitmap_size).fill(0);
        module_1[0] = 0;
        for (let i = 1; i < bitmap_size; i++) {
            module_1[i] = diff_ba[i];
        }

        // module_2: a_diff_b, mines = count_diff_ab
        const module_2 = new Uint32Array(bitmap_size).fill(0);
        module_2[0] = count_diff_ab;
        for (let i = 1; i < bitmap_size; i++) {
            module_2[i] = diff_ab[i];
        }

        // module_3: intersection, mines = b[0]
        const module_3 = new Uint32Array(bitmap_size).fill(0);
        module_3[0] = b_0;
        for (let i = 1; i < bitmap_size; i++) {
            module_3[i] = intersection[i];
        }

        return [module_1, module_2, module_3];
    }
    return [];
}
// Todo 1.4 - Algorithm Part 1 - Module Analyse
/*
这里是非常重要的说明！
Module （模块）是我自己命名的一个扫雷游戏的概念，不是公认/官方的，但在我各个版本的游戏中我都使用这个名称
我认为这个概念在求解的过程中是必需的，也是非常高效稳定和准确的，在以它为基础的分析下可以确保所有可解的情况被判断为可解
在我以往的代码实现中，我通常创建一个 Class，里面存放一个 int: number_of_mines 和一个 array: covered_positions，
分别表示这个 module 中未知的雷的数量，以及这个模块包含的坐标
我大致介绍一下它的分析方式，例如在当前棋盘上有一个数字为 1，而它周围有 3 个未打开的格子，那么我们就可以为此创建一个
module A，它的数字为 1，positions 为上述的三个格子，我们对当前所有的数字都创建一个 module 这就是 module collection
的初始化，假设现在有另一个 module B 和它相交，那么我们可以分析它们的关系，例如继续假设 B 是 2 选 1 的状态，并且 B 的
格子都属于 A，也就是说 B 是 A 的真子集，那么我们就可以创建出一个新的 module C，它的 number 为两个 module A，B 的差值，
它的 positions 为 A，B 的差集，这就是对 module collection 的扩张，更具体的算法以及优化可以查看上方的代码，下面我要
讲的是对 module 这个结构的极端优化

假设我创建一个 Module 类，我将会需要频繁的调用 getter/ setter/ constructor，并且一个实例的占用空间很大，在高频调用时
缓存压力很大。而如果用数组的形式 [n, [positions...]] 或者 [n, p1, p2, ...] 表达 module，会导致在分析两个 module 之间的
关系时操作过多，例如使用大量循环，创建大量临时数组，更重要的是它们的存储不连续，存储内容为数字，无法通过 Uint8/16/32Array
进行压缩。
因此我在此游戏中使用了位图，下面是构建逻辑
使用一些 Uint32Array 存储一个 module 的内部元素的情况，和上述存储坐标的 index 不同，位图存储的是坐标的状态，例如在 4x4 的
棋盘中，假设 (0, 0), (0, 1) 是一个 module 的所有坐标，而 4x4 只需要占 16 bit 的内存，因此这个 module 就是一个长度为 2
的 Uint32Array，其中 0 位存储坐标，1 位存储位图 [n, 0b0000...0011]
对于 X * Y > 32 的情况，由于 DATA 数据已经成功扁平化，可以用多个 32 bit 的数字分段存储它的位图，因此一个游戏中所有 module
的位图的数量在 start 函数中被计算和锁定

这种存储方式最强大的不是它的节约空间，而是在分析的过程中总是使用位运算，并且可以非常快的批量处理数据，这在下面 4 个基础的
分析 module 的函数中可以看出，以及尤其在上方把 module 中所有的坐标添加到 solutions 的函数中也可以看出
在上方的 process_module_pair 函数中可以发现函数在逻辑清晰，代码简洁的情况下一次分析了所有的情况
 */
function equals_module(a, b) {
    for (let i = 0; i < bitmap_size; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
function bitwise_intersection(a, b) {
    const result = Array(bitmap_size).fill(0);
    for (let i = 1; i <bitmap_size; i++) {
        result[i] = a[i] & b[i];
    }
    return result;
}
function bitwise_difference(a, b) {
    const result = Array(bitmap_size).fill(0);
    for (let i = 1; i < bitmap_size; i++) {
        result[i] = a[i] & ~b[i];
    }
    return result;
}
function count_bits(bitmap) {
    let count = 0;
    for (let i = 1; i < bitmap_size; i++) {
        let v = bitmap[i];
        while (v) {
            v &= v - 1;
            count++;
        }
    }
    return count;
}
// Todo 1.5 - Reset Algorithm
function reset_mines(target_mine) {
    /*
    这个函数会将输入坐标上的雷转移到其它位置，为确保移动前后所有展示出来的数字没有变化，有时实际上会移动很多关联的雷
    这个函数在调用的时候一定是 unsolvable 的状态，并且当前拥有最新计算出的 complete module collection
     */
    console.warn('start reset');
    for (const module of module_collection) {
        if (module[0] > 0 && module[0] === count_bits(module)) {
            internal_mark_cells_in_module(module);
        }
    }

    if (DATA[target_mine] & Mk_) {
        console.warn('100% mine');
        return false;
    }

    /*
    加入新的 fake-module 重新计算完整的 module collection，这一步可以计算出在玩家的选择下还有哪些
    linked selection，在重置雷的位置的时候新的雷不可以加入到这里面
     */
    init_module_collection();
    const fake_module = new Uint32Array(bitmap_size).fill(0);
    const array_position = (target_mine / 32) | 0;
    const bit_position = target_mine - array_position * 32;
    fake_module[array_position + 1] |= (1 << bit_position);
    module_collection.push(fake_module);

    calculate_partially_module_collection(false);
    calculate_complete_module_collection();
    for (const module of module_collection) {
        if (module[0] === 0) {
            add_module_cells_to_solutions(module);
        } else if (module[0] === count_bits(module)) {
            internal_mark_cells_in_module(module);
        }
    }

    const COPY = new Uint32Array(DATA);

    let counter_removed = 0;
    for (let array_position = 1; array_position < bitmap_size; array_position++) {
        for (let bit_position = 0; bit_position < 32; bit_position++) {
            if (solutions[array_position] & (1 << bit_position)) {
                const index = (array_position - 1) * 32 + bit_position;
                if (DATA[index] & Mi_) {
                    remove_mine(index);
                    counter_removed++;
                }
            }
        }
    }
    console.warn('removed ' + counter_removed);

    let counter_added = 0;
    for (let i = 0; i < X * Y; i++) {
        if ((DATA[i] & Mk_) && !(DATA[i] & Mi_)) {
            add_mine(i);
            counter_added++;
        }
    }
    console.warn('added ' + counter_added);

    const current_removed = counter_removed - counter_added;
    const current_added = counter_added - counter_removed;
    if (current_removed > 0) {
        // add removed mines
        const selections = [];
        for (let i = 0; i < X * Y; i++) {
            if ((DATA[i] & Cv_) && !(DATA[i] & Mi_)) {
                selections.push(i);
            }
        }
        if (selections.length < current_removed) {
            DATA.set(COPY);
            console.warn('reset failed');
            send_notice('reset_failed', false);
            return false;
        }
        for (let i = 0; i < current_removed; i++) {
            const rj = i + (Math.random() * (current_removed - i)) | 0;
            const temp = selections[i];
            selections[i] = selections[rj];
            selections[rj] = temp;
        }
        for (let i = 0; i < current_removed; i++) {
            add_mine(selections[i]);
        }
        console.warn('added ' + current_removed);
    } else if (current_added > 0) {
        // remove added mines
        const selections = [];
        for (let i = 0; i < X * Y; i++) {
            if ((DATA[i] & Cv_) && (DATA[i] & Mi_)) {
                selections.push(i);
            }
        }
        if (selections.length < current_added) {
            DATA.set(COPY);
            console.warn('reset failed');
            send_notice('reset_failed', false);
            return false;
        }
        for (let i = 0; i < current_added; i++) {
            const rj = i + (Math.random() * (current_added - i)) | 0;
            const temp = selections[i];
            selections[i] = selections[rj];
            selections[rj] = temp;
        }
        for (let i = 0; i < current_added; i++) {
            remove_mine(selections[i]);
        }
        console.warn('removed ' + current_added);
    }

    for (let i = 0; i < X * Y; i++) {
        if (!(DATA[i] & Cv_) && (DATA[i] & Nr_) === 0) {
            const ix = (i / Y) | 0;
            const iy = i - ix * Y;
            for (let n = 0; n < 8; n++) {
                const x = ix + DX[n];
                const y = iy + DY[n];
                if (x >= 0 && x < X && y >= 0 && y < Y) {
                    select_cell(x * Y + y);
                }
            }
        }
    }

    console.warn('reset complete');
    send_notice('reset_complete', false);
    return true;
}
function remove_mine(index) {
    DATA[index] &= ~Mi_;
    update_cell_display(index);
    const idx = (index / Y) | 0;
    const idy = index - idx * Y;
    for (let n = 0; n < 8; n++) {
        const x = idx + DX[n];
        const y = idy + DY[n];
        if (x >= 0 && x < X && y >= 0 && y < Y) {
            const i = x * Y + y;
            DATA[i]--;
            update_cell_display(i);
        }
    }
}
function add_mine(index) {
    DATA[index] |= Mi_;
    update_cell_display(index);
    const idx = (index / Y) | 0;
    const idy = index - idx * Y;
    for (let n = 0; n < 8; n++) {
        const x = idx + DX[n];
        const y = idy + DY[n];
        if (x >= 0 && x < X && y >= 0 && y < Y) {
            const i = x * Y + y;
            DATA[i]++;
            update_cell_display(i);
        }
    }
}
// Todo 1.6 - Administrator Function
function activate_algorithm(password) {
    if (hash_x(password) !== STORED_HASH) return;
    algorithm_enabled = true;
    update_solvability_info();
    console.warn("Algorithm activated.");
}
function deactivate_algorithm() {
    algorithm_enabled = false;
    update_solvability_info();
    console.warn("Algorithm deactivated.");
}
function test(i) {
    start({test_id : i});
}



// < Part 2 - UI >

// Todo 2.1 - Init
function init_information_box() {
    document.getElementById("status-info").textContent = "Ready to start";
    document.getElementById("time-info").textContent = "---";

    document.getElementById('size-info').textContent = `${X} × ${Y} / Mines ${N}`;
    document.getElementById('marks-info').textContent = counter_marked.toString();

    const density = (N / (X * Y) * 100).toFixed(2);
    document.getElementById('density-info').textContent = `${density}%`;
}
function render_border() {
    const BORDER_OFFSET = 1;
    const BORDER_OFFSET_OUTLINE = 3;

    const width = Y * CELL_SIZE;
    const height = X * CELL_SIZE;

    const border = document.getElementById('border');
    border.style.width = `${width + 2 * BORDER_OFFSET}px`;
    border.style.height = `${height + 2 * BORDER_OFFSET}px`;
    border.style.left = `${-BORDER_OFFSET}px`;
    border.style.top = `${-BORDER_OFFSET}px`;

    const border_outline = document.getElementById('border-outline');
    border_outline.style.width = `${width + 2 * BORDER_OFFSET_OUTLINE}px`;
    border_outline.style.height = `${height + 2 * BORDER_OFFSET_OUTLINE}px`;
    border_outline.style.left = `${-BORDER_OFFSET_OUTLINE}px`;
    border_outline.style.top = `${-BORDER_OFFSET_OUTLINE}px`;
}
function generate_game_field() {
    CELL_ELEMENTS = new Array(X * Y);
    const board_element = document.getElementById("board");
    board_element.innerHTML = "";

    board_element.style.gridTemplateRows = `repeat(${X}, ${CELL_SIZE}px)`;
    board_element.style.gridTemplateColumns = `repeat(${Y}, ${CELL_SIZE}px)`;

    for (let i = 0; i < X * Y; i++) {
        const div = document.createElement("div");
        div.className = "cell";
        div.style.fontSize = `${FONT_SIZE}px`;
        div.dataset.index = i.toString()
        div.addEventListener("click", () => select_cell(i));
        div.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            mark_cell(i);
        });
        board_element.appendChild(div);
        CELL_ELEMENTS[i] = div;
    }
}
// Todo 2.2 - Edit Game Status
function set_difficulty(difficulty) {
    current_difficulty = difficulty;
    start();
    close_difficulty_menu();
}
function set_background(filename) {
    document.documentElement.style.setProperty('--background-url', `url("Background_Collection/${filename}")`);
    close_background_menu();
}
// Todo 2.3 - Update Game Information
function update_cell_display(i) {
    const target_element = CELL_ELEMENTS[i];
    const target_cell = DATA[i];
    if (target_cell & Cv_) {
        return;
    }

    if (target_cell & Mi_) {
        target_element.textContent = ' ';
        target_element.classList.add('mine');

        terminate(false);
    } else {
        const number = (target_cell & Nr_);
        target_element.textContent = number > 0 ? number : ' ';
        target_element.classList.add('revealed');
    }
}
function start_timer() {
    start_time = Date.now();
    timer_interval = setInterval(update_time_info, 100);
}
function terminate(completed) {
    game_over = true;
    clearInterval(timer_interval);
    if (completed) {
        document.getElementById('status-info').textContent = 'Completed';
        send_notice('congrats');
    } else {
        document.getElementById('status-info').textContent = 'Failed';
        send_notice('failed');
    }
}
function update_time_info() {
    const elapsed = (Date.now() - start_time) / 1000;
    document.getElementById('time-info').textContent = `${elapsed.toFixed(1)} s`;
}
function update_marks_info() {
    document.getElementById('marks-info').textContent = counter_marked;
}
function update_solvability_info() {
    if (algorithm_enabled) {
        check_solvability();
        document.getElementById('solvability-info').textContent = solvable ? 'True' : 'False';
    } else {
        document.getElementById('solvability-info').textContent = '---';
    }
}
// Todo 2.4 - Message / Shortcuts
function send_notice(type, locked = true) {
    const now = Date.now();
    if (locked) {
        if (locked && now - last_notice_time < 600) {
            return;
        }
        last_notice_time = now;
    }

    const container = document.getElementById('notice-container');
    const notice = document.createElement('div');
    const notice_text = document.createElement('div');
    const notice_progress = document.createElement('div');
    notice.classList.add('notice');
    notice_text.classList.add('notice-text');
    notice_progress.classList.add('notice-progress');
    switch (type) {
        case 'congrats':
            notice_text.innerHTML = "Congratulations.<br> You've successfully completed Minesweeper.";
            notice_progress.style.backgroundColor = 'rgba(0, 220, 80, 1)';
            break;
        case 'failed':
            notice_text.innerHTML = "Failed.<br> You triggered a mine.";
            notice_progress.style.backgroundColor = 'rgba(255, 20, 53, 1)';
            break;
        case 'n_enabled':
            notice_text.innerHTML = "Warning.<br> Algorithm was not activated.";
            notice_progress.style.backgroundColor = 'rgba(255, 150, 0, 1)';
            break;
        case 'reset_complete':
            notice_text.innerHTML = "Reset Complete.";
            notice_progress.style.backgroundColor = 'rgba(0, 220, 80, 1)';
            break;
        case 'reset_failed':
            notice_text.innerHTML = "Reset Failed.";
            notice_progress.style.backgroundColor = 'rgba(255, 20, 53, 1)';
            break;
        case 'copied':
            notice_text.innerHTML = "Email address copied to clipboard.";
            notice_progress.style.backgroundColor = 'rgba(0, 220, 80, 1)';
            break;
        default:
            notice_text.innerHTML = "Notice.<br> Default Notice Content - 1024 0010 0024.";
            notice_progress.style.backgroundColor = 'rgba(0, 150, 255, 1)';
            break;
    }
    notice_progress.style.animation = `progressShrink ${TIMEOUT}ms linear forwards`;
    notice.appendChild(notice_text);
    notice.appendChild(notice_progress);
    notice.onclick = () => {
        if (container.contains(notice)) {
            container.removeChild(notice);
        }
    };
    notice.style.animation = 'slideInRight 0.3s ease forwards';
    container.appendChild(notice);
    setTimeout(() => {
        notice.style.animation = 'fadeOutUp 0.3s ease forwards';
        setTimeout(() => {
            if (container.contains(notice)) {
                container.removeChild(notice);
            }
        }, 300);
    }, TIMEOUT);
}
function handle_keydown(event) {
    const key = event.key.toLowerCase();
    switch (key) {
        case 'escape':
            hide_guide();
            close_difficulty_menu();
            close_background_menu();
            return;
        case 'c':
            toggle_sidebar();
            return;
        case 'f':
            if (cursor_enabled) {
                cursor_enabled = false;
                CELL_ELEMENTS[cursor_x * Y + cursor_y].classList.remove('cursor');
            } else {
                cursor_enabled = true;
                CELL_ELEMENTS[cursor_x * Y + cursor_y].classList.add('cursor');
            }
            return;
        case 'r':
            start();
            return;
        case 'h':
            send_hint();
            break;
        case '0':
            solve();
            break;
    }

    if (!cursor_enabled) return;

    const step = event.shiftKey ? 4 : 1;
    cursor_path = cursor_x * Y + cursor_y;
    switch (key) {
        case 'w':
        case 'arrowup':
            cursor_x = Math.max(0, cursor_x - step);
            break;
        case 's':
        case 'arrowdown':
            cursor_x = Math.min(X - 1, cursor_x + step);
            break;
        case 'a':
        case 'arrowleft':
            cursor_y = Math.max(0, cursor_y - step);
            break;
        case 'd':
        case 'arrowright':
            cursor_y = Math.min(Y - 1, cursor_y + step);
            break;
        case 'm':
            mark_cell(cursor_x * Y + cursor_y);
            break;
        case ' ':
            select_cell(cursor_x * Y + cursor_y);
            break;
    }
    updateCursor();
}
// Todo 2.5 - Sidebar
function toggle_sidebar() {
    document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', document.body.classList.contains('sidebar-collapsed').toString());

    close_difficulty_menu();
    close_background_menu();
}
function toggle_information() {
    const info_list = document.getElementById('information-list');
    if (info_list.style.display === 'block') {
        info_list.style.display = 'none';
        document.getElementById('information-btn').classList.remove('selected');
    } else {
        info_list.style.display = 'block';
        document.getElementById('information-btn').classList.add('selected');
    }
}
function toggle_difficulty_dropdown() {
    if (document.getElementById('difficulty-menu').style.display === 'none') {
        open_difficulty_menu();
    } else {
        close_difficulty_menu();
    }
    close_background_menu();
}
function toggle_background_dropdown() {
    if (document.getElementById('background-menu').style.display === 'none') {
        open_background_menu();
    } else {
        close_background_menu();
    }
    close_difficulty_menu();
}
function toggle_guide() {
    document.getElementById('guide-modal').style.display = 'block';
}
function hide_guide() {
    document.getElementById('guide-modal').style.display = 'none';
    document.getElementById('guide-btn').classList.remove('selected');
}
function close_guide(event) {
    const content = document.getElementById('guide-content');
    if (!content.contains(event.target)) {
        hide_guide();
    }
}
function open_difficulty_menu() {
    document.getElementById('difficulty-menu').style.display = 'block';
    document.getElementById('difficulty-btn').classList.add('selected');
}
function open_background_menu() {
    document.getElementById('background-menu').style.display = 'block';
    document.getElementById('background-btn').classList.add('selected');
}
function close_difficulty_menu() {
    document.getElementById('difficulty-menu').style.display = 'none';
    document.getElementById('difficulty-btn').classList.remove('selected');
}
function close_background_menu() {
    document.getElementById('background-menu').style.display = 'none';
    document.getElementById('background-btn').classList.remove('selected');
}
// Todo 2.6 - Cursor
function updateCursor() {
    CELL_ELEMENTS[cursor_path].classList.remove('cursor');
    if (cursor_enabled) {
        const target_element = CELL_ELEMENTS[cursor_x * Y + cursor_y];
        target_element.classList.add('cursor');
    }
}
// Todo 2.7 - Text Copy
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            send_notice('copied');
        })
        .catch((err) => {
            const range = document.createRange();
            range.selectNode(document.querySelector("#guide-content p"));
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            document.execCommand('copy');
            window.getSelection().removeAllRanges();
            send_notice('copied');
        });
}



// < Part 3 - Init / Load >

// Todo 3.1 - Init Game / Load Monitor
document.addEventListener('keydown', handle_keydown);
start();