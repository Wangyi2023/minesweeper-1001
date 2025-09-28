// script_main.js - 28.08.2025

// < Part 0 - Define Global-Variables >

/*
X 为矩阵的行数，Y 为列数，N 为雷的数量，DATA 为存储矩阵信息的高密度容器，数据类型为 Uint8Array。
具体存储方式为，将存储单个方格（Cell）的二维矩阵扁平化为一维数组，用 8 位存储单个格子的全部信息，具体存储方式在下面表格中。
这种存储 DATA 的方式是优化到极限的，在高频访问时对缓存极其友好，并且在更改内部数据的时候全部使用位运算，速度极快。
而 CELL_ELEMENTS 只用于存储单个方格对应的页面上的元素（div）的索引，只用于渲染游戏界面。
它无法被 Uint8Array 压缩，只能用普通数组存储。
它的作用是在局部更新游戏界面时快速寻找到需要渲染的方格，而不必频繁调用非常缓慢的 querySelector。
 */
let X, Y, N, DATA, CELL_ELEMENTS;
/*
下面是用 8 位存储单个方格的全部信息的方式
---------------------------------------------------------------------
| internal-mark   | visited   | covered   | mine   | number (0-8)   |
| bit 7           | bit 6     | bit 5     | bit 4  | bit 0-3        |
---------------------------------------------------------------------
由于 number 这一项信息的数据类型为 int，我选择把它放到最低位，这样只需掩码位运算就可获取到 int 以及更改它的值。如果放在高位
需要额外的左移和右移运算。在游戏中它的值为 0-8，因此只需要 4 bit 的位置即可存储这项信息。
其它元素均为 boolean，随意放置不影响性能。
其中 internal-mark 是内部标记，用于内部算法计算。与 mark 外部标记不同，外部标记由玩家操控，用于辅助玩家完成游戏，因此外部标记
不需要存储到 DATA 中，而是以 'marked' 属性存储在 CELL_ELEMENTS 对应元素的 ClassList 中，对其的更改不会影响主要游戏数据。
属性 visited 的唯一作用是辅助延迟打开。
通过与掩码位运算可提取和修改它们的各项信息，如下：
DATA[x * Y + y] & NUMBER_MASK     <-> number on the cell (x, y)
DATA[x * Y + y] & MINE_MAS        <-> cell (x, y) is mine
DATA[x * Y + y] & COVERED_MASK    <-> cell (x, y) is covered
 */
const Nr_ = 0b00001111;
const Mi_ = 0b00010000;
const Cv_ = 0b00100000;
const Vs_ = 0b01000000;
const Mk_ = 0b10000000;
/*
游戏 ID 的作用是在一些延迟操作中，若操作未结束时玩家强行重设棋盘，尚未完成的延时操作会在重设后由于 ID 的改变被迫中断。
 */
let ID = 0;
/*
DX 和 DY 的作用是快速获取和遍历一个坐标的所有周围坐标。为满足特殊需求比如有时只需要分析上下左右的方向，我将上下左右的坐标
放置于前 4 位，可快速截断。整体遍历顺序为顺时针方向，这仅仅时为了优化延迟展开的效果。
 */
const DX = [-1, 0, 1, 0, -1, 1, 1, -1];
const DY = [0, 1, 0, -1, 1, 1, -1, -1];
/*
这里是测试列表，在测试模式中会创建 8x8 特定放置雷的测试棋盘，并自动打开右上角 (7, 0) 坐标。
测试通过在控制台使用 test 函数调用，以下测试主要用于检测 reset_mines 功能。
 */
const TEST_CONFIG = {
    1  : { Mines: [[0, 0], [2, 0], [2, 1]] },
    2  : { Mines: [[0, 0], [0, 1], [2, 0], [2, 1]] },
    3  : { Mines: [[0, 1], [1, 0], [2, 1], [3, 0], [3, 1]] },
    4  : { Mines: [[0, 0], [2, 0], [3, 0], [5, 0], [5, 1]] },
    5  : { Mines: [[0, 0], [2, 0], [3, 0], [5, 0], [6, 0]] },
    6  : { Mines: [[0, 0], [1, 1], [2, 2]] },
    7  : { Mines: [[0, 1], [1, 0], [2, 2]] },
    8  : { Mines: [[0, 1], [1, 0], [2, 2], [5, 5], [6, 7], [7, 6]] },
    9  : { Mines: [[0, 0], [0, 1], [1, 0], [2, 2], [5, 5], [6, 6], [7, 7]] },
    10 : { Mines: [[0, 0], [0, 1], [1, 0], [2, 2], [5, 5], [6, 6]] },
    11 : { Mines: [[0, 0], [0, 2], [1, 1], [2, 1], [4, 1], [4, 2], [5, 0], [5, 1], [5, 2]] },
    12 : { Mines: [[0, 1], [0, 2], [1, 1], [3, 1], [4, 1], [4, 2], [5, 0], [5, 1], [5, 2]] },
    13 : { Mines: [[0, 0], [0, 2], [2, 1], [4, 2], [5, 0], [5, 1], [5, 2]] },
    14 : { Mines: [[0, 1], [0, 2], [3, 1], [4, 2], [5, 0], [5, 1], [5, 2]] },
}
const TEST_SIZE = Object.keys(TEST_CONFIG).length;
/*
这里是消息，普通消息的内容和进度条的颜色在此确认。
 */
const NOTICE_CONFIG = {
    congrats: {
        text: "Congratulations.<br>You've successfully completed Minesweeper.",
        color: 'rgba(0, 220, 80, 1)'
    },
    failed: {
        text: "Failed.<br>You triggered a mine.",
        color: 'rgba(255, 20, 53, 1)'
    },
    alg_not_enabled: {
        text: "Warning.<br>Algorithm was not activated.",
        color: 'rgba(255, 150, 0, 1)'
    },
    reset_complete: {
        text: "Reset Complete.",
        color: 'rgba(0, 220, 80, 1)'
    },
    reset_failed: {
        text: "Reset Failed.",
        color: 'rgba(255, 20, 53, 1)'
    },
    alg_activated: {
        text: "Algorithm Activated.",
        color: 'rgba(255, 230, 0, 1)'
    },
    alg_deactivated: {
        text: "Algorithm Deactivated.",
        color: 'rgba(255, 230, 0, 1)'
    },
    test_start: {
        text: "Test Mode Activated.<br>Sidebar adjusted, shortcuts disabled.",
        color: 'rgba(0, 150, 255, 1)'
    },
    test_end: {
        text: "Test Mode Deactivated.<br>Sidebar adjusted, shortcuts enabled.",
        color: 'rgba(0, 150, 255, 1)'
    },
    copied: {
        text: "Hint.<br>Email address copied to clipboard.",
        color: 'rgba(0, 150, 255, 1)'
    },
    algorithm_off: {
        text: "Algorithm OFF.<br>Algorithm off due to large board size.",
        color: 'rgba(255, 230, 0, 1)'
    },
    animation_off: {
        text: "Animation OFF.<br>Animation off due to large board size.",
        color: 'rgba(255, 230, 0, 1)'
    },
    default: {
        text: "Notice.<br>Default Notice Content - 1024 0010 0024.",
        color: 'rgba(0, 150, 255, 1)'
    },
    screenshot: {
        text: "Screenshot Completed.<br>Screenshot saved to default folder",
        color: 'rgba(0, 220, 80, 1)'
    }
};

const CELL_SIZE = 24;
const FONT_SIZE = 16;
const ALGORITHM_LIMIT = 4800;
const ANIMATION_LIMIT = 1200;
const NOTICE_TIME_LIMIT = 800;
const DELAY = 5;
const TIMEOUT = 4500;

let current_difficulty = 'high';
let current_test_id = null;

let first_step = true;
let game_over = false;
let is_solving = false;

let animation_timers = [];
let start_time = null;
let timer_interval = null;
let last_notice_time = 0;

let algorithm_enabled = true;
let cursor_enabled = false;

let counter_revealed, counter_marked;
let cursor_x, cursor_y, cursor_path;

let module_collection = [];
let bitmap_size;
let solutions;
let solvable = false;



// < Part 1 - Game Logic >

// Todo 1.1 - Init
function start() {
    ID++;
    clear_all_animation_timers();

    if (current_test_id !== null) {
        const params = TEST_CONFIG[current_test_id];
        X = 8;
        Y = 8;
        N = params.Mines.length;
        first_step = false;
        init_board_data();

        for (const [x, y] of params.Mines) {
            set_mine(x * Y + y);
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

    if (X * Y <= ALGORITHM_LIMIT) {
        algorithm_enabled = true;
    } else {
        algorithm_enabled = false;
        send_notice("algorithm_off");
    }

    module_collection.length = 0;
    bitmap_size = Math.ceil(X * Y / 32) + 1;
    solutions = new Uint32Array(bitmap_size).fill(0);
    solvable = false;
    is_solving = false;
    game_over = false;
    counter_revealed = 0;
    counter_marked = 0;

    cursor_x = (X / 3) | 0;
    cursor_y = (Y / 3) | 0;
    cursor_path = cursor_x * Y + cursor_y;

    start_time = null;
    clearInterval(timer_interval);

    generate_game_field();
    render_border();
    init_information_box();
    update_solvability_info();
    update_mines_visibility()
    update_cursor();
    play_start_animation();
}
function init_board_data() {
    /*
    此函数的作用仅仅是初始化棋盘，不添加雷，目的是在玩家选择第一个格子后才通过下面的 init_mines 函数确认雷的位置。
    实际上这个目的也可以通过重设棋盘来完成，但是它的消耗量相对较大。甚至一些作者会通过在玩家选择第一个格子后不断 restart，
    直到玩家选择的位置不是雷为止，这样的代码非常简单但是浪费了很多算力。
     */
    DATA = new Uint8Array(X * Y).fill(Cv_);
}
function init_mines(target_number_of_mines, position_first_click) {
    /*
    这个函数的作用是随机摆放雷的位置，position_first_click 为输入的赦免坐标，确保雷不会摆放到此坐标及其相邻坐标，方式如下：
    创建一个 Uint32Array 用作打乱后的指针列表，将需要赦免的坐标依次交换到数组最后，然后打乱除赦免坐标的部分，最后取前 n 个坐标
    将其全部设为雷，并同步更新每一个雷及其周围元素的信息。
    注意这里使用了一些优化方式，首先所谓的交换实际上是直接把后面的数字取出然后覆盖到赦免坐标的 index 上，因为最后的几个坐标是
    需要完全忽视的，也就是 index >= size 的坐标，它们的值是无意义的，更改 size 即可将其视为数组的无效数据部分。
    其次打乱时真正被有效打乱的是前 n 个最后需要被放置雷的坐标，对于第 i 个坐标，会取任意一个在 [i, size) 之间的坐标与之交换，
    这个操作截至到 size 就结束了，后面的数据只会与更靠后的数据交换，所以打乱没有意义。
    其次摆放雷的时候不需要使用规范的 add_mine 函数，因为所有方格目前都在未打开状态，不需要更新渲染。
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
// Todo 1.2 - Edit Main Field
function select_cell(i) {
    /*
    这是玩家层面的选择方格函数，它会对特殊情况进行特定的处理，再调用规范的 reveal_cell 函数进行打开格子。
     */
    if (game_over) {
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
        return;
    }

    if (first_step) {
        init_mines(N, i);
        document.getElementById('status-info').textContent = 'In Progress';
        first_step = false;
        start_timer();
    }
    if (!solvable && (DATA[i] & Mi_)) {
        reset_mines(i);
    }

    admin_reveal_cell(i, ID);
    if (!(DATA[i] & Nr_) && !(DATA[i] & Mi_)) {
        reveal_linked_cells_with_delay(i, ID);
    }
}
function reveal_linked_cells_with_delay(i, current_id) {
    /*
    这个函数的作用是，对于点击到数字为 0 的坐标，自动打开其相邻的所有坐标，为实现动画效果，这里给需要打开的坐标加上了延时。
    而为了实现扩散效果，这里使用广度优先搜索 BFS 将需要打开的坐标加入优先队列。
    为避免 queue 中重复元素过多，去重的方式为，将添加过的坐标直接在 DATA 中使用 visited 标签标记。这恰好将 DATA 中每个坐标
    拥有的 8 位存储空间利用到极致。
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
    注意！所有 reveal cell 的行为必须通过此 admin_reveal_cell 函数，因为所有游戏状态的检测和修改都在此函数内，此处为分界线。
    算法也统一在此处更新，因为每次棋盘内容有变动都需要及时更新可解性（solvability）信息。
     */
    if (game_over) {
        return;
    }
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
    update_cell_display(i);
    remove_cell_from_solutions(i);
    update_solvability_info();
    counter_revealed++;

    if (!game_over && counter_revealed === X * Y - N) {
        terminate(true);
    }
}
function mark_cell(i) {
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
        send_notice('alg_not_enabled');
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
    /*
    自动标记与求解（Solve）和提示（Hint）不同，求解是在解的列表（solutions）中提取元素打开，但是为确保游戏不卡顿，不会在
    玩家每次点击后都计算解，而是在 solutions 为空的时候再计算解，相当于补充库存，并且计算时会在找到一个解就及时 return，
    不会计算出全部解。而自动标记我认为需要的是把当前所有可标记的都标记上，因此需要先计算出全部雷的位置，再标记。
    注意！这里我一样计算的是模块集（module_collection），因为它的计算函数是万能的，在计算的过程中会顺便把所有雷的位置标记上，其目的
    实际上只是为了缩小模块集的规模，具体详见函数段落 1.4。
     */
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('alg_not_enabled');
        return;
    }
    init_module_collection();
    calculate_partially_module_collection(false);
    calculate_complete_module_collection();
    for (let i = 0; i < X * Y; i++) {
        if ((DATA[i] & Mk_) && (DATA[i] & Cv_)) {
            const target_element = CELL_ELEMENTS[i];
            if (!target_element.classList.contains('marked')) {
                target_element.classList.add('marked');
                counter_marked++;
            }
        }
    }
    update_marks_info();
}
function solve() {
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('alg_not_enabled');
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
        send_notice('alg_not_enabled');
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
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    document.getElementById('solve-all-btn').classList.remove('selected');
    is_solving = false;
}
// Todo 1.4 - Algorithm Part 1
function check_solvability() {
    /*
    在这个函数中我们会查看 solutions 列表的大小，这个列表非空意味着有解。如果当前无解，就不断地进行计算更多模块（module）
    如果计算到完全模块集（complete_module_collection）还没有解，说明当前局面是无法通过计算得出解的。
    逐步计算的目的是减轻计算机负担，因为实际上在每次玩家打开方格的时候都需要检测更新可解性（solvability），如果每次都以
    计算出所有解为目的的话，会导致明显的延迟。
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
    此函数运行的条件是，仅靠 init_module_collection 函数创建的初始模块集无法继续通过内部元素的迭代计算找到解，
    因此在这个函数中不必再迭代，而是需要手动添加一个全局模块（inverse module），后续简称 inverse。

    注意！这一步不能将其加入模块集然后继续进行内部迭代运算，会产生非常多的无效模块导致卡顿，最好的方式是先将被标记为
    雷的坐标排除在 inverse 之外，然后不断取模块集中的模块出来尝试缩小 inverse 的范围。
    inverse 元素能提供的一个重要信息是雷的总数，这是其它模块提供不了的。例如当棋盘上有 4 个未打开且不确定的方格，
    而目前只剩 1 个雷的位置不确定，那么创建出的初始的 inverse 就是 4 选 1 的状态，如果这时还有一个模块是 2 选 1
    的状态，那么可以将这个模块从 inverse 中剔除，更新后的 inverse 就是 2 选 0 的状态。
    这种思想就是 inverses Element，所以我这样命名。
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

    for (const module of module_collection) {
        const created_module = process_module_pair(module, inverse_module);
        if (created_module.length === 1) {
            inverse_module = created_module[0];
        }
    }
    if (inverse_module[0] === 0) {
        add_module_cells_to_solutions(inverse_module);
    } else {
        safe_push_module(inverse_module);
        calculate_partially_module_collection(false);
    }
}
function calculate_partially_module_collection(return_enabled = true) {
    /*
    此函数是与 init_module_collection 函数配套使用的，在由对方创建的初始模块集中，遍历所有模块让它们相互运算产生新的模块。
    此函数可以有两种用法，通过输入参数控制，默认使用方法是以发现解为目的，一旦检测到某个模块中雷数为 0，将会在把这个模块中的
    方格全部标记为解后迅速终止计算。
    但是有时我们需要第二种用法：以计算出所有能计算出的模块为目的。例如在自动标记（auto_mark）功能中，我的意愿就是标记所有
    可确认的雷，那么自然会需要所有的模块。在重置雷（reset）方法中也必须用到它。
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
                    console.log(`2. partially ${module_collection.length}`);
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
    此函数的作用是初始化模块集。方法是如下：
    分析当前每个不覆盖的方格，先分析它周围的空格数量是否等于它自身的数字，如果相等将这个方格进行内部标记（internal mark）
    对于被内部标记的格子，在创建模块的时候不会考虑到它，这样可以大幅减少模块集合的规模。
    注意！这个标记和创建模块的过程实际上是相互辅佐的，我们会先创建一个模块，每当发现数字方格周围的一个未打开方格有内部标记时，
    不会把这个内部标记加入模块中。
    最后如果模块中未确认的雷的数量恰好等于它的未打开的方格的数量，这个模块不仅不会被添加到模块集里，还会将其内部的所有方格进行
    内部标记，以便在创建其它模块时可以不需要再次辨别。
     */
    module_collection.length = 0;
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
            }
            safe_push_module(module);
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
    此函数会分析两个输入模块的关系，并尝试生成所有可能的新模块。
    它的优化在于一次遍历直接分析出两个元素的所有关系，然后按照关系耗时和关系出现频率依次处理，比如不相交（disjoint）和
    相等（equals）的情况最常见和简单，可快速排除。巧妙的是排除后就不需要考虑真包含（real subset）和包含（subset）的区别，
    而下一步排除了包含关系就不再需要判断真相交（real intersect）和相交（intersect）的区别（这里我用到的真相交是指两者相交
    但不存在包含关系）。
    由于模块（module）的设计是完美的，分析两个模块以及创建新模块的代码非常简单。
     */
    let equals = true;
    let a_subset_b = true;
    let b_subset_a = true;
    let intersect = false;

    for (let i = 1; i < bitmap_size; i++) {
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
        for (let i = 1; i < bitmap_size; i++) {
            c[i] = b[i] & ~a[i];
        }
        return [c];
    }
    if (b_subset_a) {
        const c = new Uint32Array(bitmap_size).fill(0);
        c[0] = a_0 - b_0;
        for (let i = 1; i < bitmap_size; i++) {
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
Module（模块）是我自己命名的一个扫雷游戏的概念，不是官方的/公认的，但在我各个版本的游戏中，我都使用了这个名称。
我认为这个概念在求解的过程中是高效稳定和准确的，在以它为基础的分析下可以确保所有可解的情况被判断为可解，与另外两种方式比较：
相较于 “计算动态概率分析” 更能解出特殊情况，相较于 “构建线性方程组求解” 更能处理大数据情况。

在我以往的代码实现中，我通常创建一个类（Class Module），里面存储 int: number_of_mines 和 array/set: covered_positions，
分别表示单个模块中雷的数量和方格（坐标）。
我大致介绍一下它的分析方式，例如在当前棋盘上有一个数字为 1，而它周围有 3 个未打开的格子，那么我们就可以为此创建一个模块 A，
它的数字为 1，方格为上述的三个格子，我们对当前每一个数字都创建一个模块，这就是模块集的初始化（init）。假设现在有另一个模块 B
与 A 相交，那么我们可以分析它们的关系。那就继续假设 B 是 2 选 1 的状态，并且 B 的格子都属于 A，也就是说 B 是 A 的真子集，
我们就可以创建一个新的模块 C，它的雷数为 AB 的差值（A.number - B.number），方格为差集（A.positions \ B.positions），
这就是对模块集的扩张。
具体的算法以及优化请查看代码，下面我要讲的是对模块这个结构的极端优化。

假设我创建一个类（Class Module），或者不封装用数组的形式 [n, [positions...]]，或者直接以 [n, p1, p2, ...] 表达模块，
会导致在分析两个之间的关系时操作过多，例如使用大量循环，创建大量临时数组。更重要的是它们的存储不连续，存储内容为数字，无法通过
Uint8/16/32Array 进行压缩。
在此我使用了新的存储方式：使用一个 Uint32Array 存储一个模块的两个信息。和上述存储方格的索引不同，这里使用位图存储方格的状态。
例如在 4x4 的棋盘中，(0,0), (0,1), (1,1) 是一个模块的所有方格，由于 4x4 只需要占 16 bit 的内存，只需要一个位图就可存下，
那这个模块就是一个长度为 2 的 Uint32Array。由于方格索引在被一维压缩优化后是 0,1,4，这个模块是这样的：[n, 0b00...10011]。

对于 X * Y > 32 的情况，只需用多个 32 位数字分段存储它的位图，因此一个游戏中所有模块的长度（bitmap_size）在 start 函数中
被计算和锁定。

这种存储方式最强大的不是它的节约空间，而是在分析的过程中总是使用位运算，并且可以批量处理数据，这在下面 4 个基础的
分析模块的函数中可以看出，但我认为最大的成效是，在模块中添加和删除方格时间复杂度为 O(1)，甚至在模块中添加和删除 n 个方格，
时间复杂度都还是 O(1)，空间消耗几乎为 0，具体请参考将模块中所有方格标记为解的函数（add_module_cells_to_solutions），为了
让模块与解列表（solutions）无障碍接轨，解列表也是位图结构（不使用它的第 0 位）。
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
    const result = new Uint32Array(bitmap_size).fill(0);
    for (let i = 1; i < bitmap_size; i++) {
        result[i] = a[i] & b[i];
    }
    return result;
}
function bitwise_difference(a, b) {
    const result = new Uint32Array(bitmap_size).fill(0);
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
    此函数会将输入坐标上的雷转移到其它位置，为确保移动前后所有展示出的数字没有变化，有时实际上必须移动很多关联的雷。
    转移的方法如下：
    首先根据当前完整的模块集，标记所有一定是雷的方格。然后重置模块集，从头开始计算完整的模块集。
    在初始化模块集后加入假模块，它的作用是将当前的雷所在方格标记为解，在此基础上计算完整模块集。最后维持雷的总数。
     */
    if (!algorithm_enabled) {
        return;
    }

    let test_result_text = '';

    const text_01 = 'Reset Algorithm Activated.';
    test_result_text += text_01 + '<br>';
    console.warn(text_01);
    for (const module of module_collection) {
        if (module[0] > 0 && module[0] === count_bits(module)) {
            internal_mark_cells_in_module(module);
        }
    }

    if (DATA[target_mine] & Mk_) {
        const text_02 = 'Clicked a cell that is definitely a mine'
        test_result_text += text_02 + '<br>';
        console.warn(text_02);

        send_test_result_notice(test_result_text);
        return false;
    }

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

    const COPY = new Uint8Array(DATA);

    let removed_candidate_list_1 = ` `;
    let added_candidate_list_1 = ` `;
    let removed_counter_1 = 0;
    let added_counter_1 = 0;

    let added_candidate_list_2 = ' '
    let added_counter_2 = 0;

    let removed_candidate_list_3 = ` `;
    let added_candidate_list_3 = ` `;


    // 1. Phase Begin
    for (let array_position = 1; array_position < bitmap_size; array_position++) {
        for (let bit_position = 0; bit_position < 32; bit_position++) {
            if (solutions[array_position] & (1 << bit_position)) {
                const index = (array_position - 1) * 32 + bit_position;
                if (DATA[index] & Mi_) {
                    remove_mine(index);
                    const ix = (index / Y) | 0;
                    const iy = index - ix * Y
                    removed_candidate_list_1 += `[${ix},${iy}] `
                    removed_counter_1++;
                }
            }
        }
    }
    if (removed_counter_1 > 0) {
        const text_11 = `1.Phase removed ${removed_counter_1}: <br>${removed_candidate_list_1}`
        test_result_text += text_11 + '<br>'
        console.warn(text_11);
    }

    for (let index = 0; index < X * Y; index++) {
        if ((DATA[index] & Mk_) && !(DATA[index] & Mi_)) {
            set_mine(index);
            const ix = (index / Y) | 0;
            const iy = index - ix * Y
            added_candidate_list_1 += `[${ix},${iy}] `
            added_counter_1++;
        }
    }
    if (added_counter_1 > 0) {
        const text_12 = `1.Phase added ${added_counter_1}: <br>${added_candidate_list_1}`
        test_result_text += text_12 + '<br>'
        console.warn(text_12);
    }
    // 1. Phase End


    // 2. Phase Begin
    const linked_number_cells = [];
    const linked_covered_cells_set = new Set();
    for (let i = 0; i < X * Y; i++) {
        if (DATA[i] & Cv_) {
            continue;
        }
        if ((DATA[i] & Nr_) !== (COPY[i] & Nr_)) {
            linked_number_cells.push(i);
            const ix = (i / Y) | 0;
            const iy = i - ix * Y;
            for (let n = 0; n < 8; n++) {
                const x = ix + DX[n];
                const y = iy + DY[n];
                if (x >= 0 && x < X && y >= 0 && y < Y) {
                    const index = x * Y + y;
                    if (index !== target_mine) {
                        if (!(DATA[index] & Mi_) && (DATA[index] & Cv_)) {
                            linked_covered_cells_set.add(index);
                        }
                    }
                }
            }
        }
    }

    const linked_covered_cells = Array.from(linked_covered_cells_set);
    if (linked_covered_cells.length > 0) {
        let number_changed = true;
        if (linked_covered_cells.length < 12) {
            number_changed = !recursive_add_mines(COPY, linked_number_cells, linked_covered_cells);
            for (const i of linked_covered_cells) {
                if (DATA[i] & Mi_) {
                    const ix = (i / Y) | 0;
                    const iy = i - ix * Y;
                    added_counter_2++;
                    added_candidate_list_2 += `[${ix},${iy}] `
                }
            }
        }
        if (number_changed) {
            console.warn('Number Changed!');
        }
        const text_21 = `2.Phase added ${added_counter_2}: <br>${added_candidate_list_2}`
        test_result_text += text_21 + '<br>'
        console.warn(text_21);
    }
    // 2. Phase End


    // 3. Phase - Begin
    const current_number_of_mines = count_number_of_mines();
    const current_removed = N - current_number_of_mines;
    const current_added = current_number_of_mines - N;

    if (current_added > 0) {
        const selections_1 = [];
        const selections_2 = [];
        for (let i = 0; i < X * Y; i++) {
            if ((DATA[i] & Cv_) && (DATA[i] & Mi_) && i !== target_mine) {
                const ix = (i / Y) | 0;
                const iy = i - ix * Y;
                let valid = true;
                for (let n = 0; n < 8; n++) {
                    const x = ix + DX[n];
                    const y = iy + DY[n];
                    if (x >= 0 && x < X && y >= 0 && y < Y) {
                        if (!(DATA[x * Y + y] & Cv_)) {
                            valid = false;
                            break;
                        }
                    }
                }
                if (valid) {
                    selections_1.push(i);
                } else {
                    selections_2.push(i);
                }
            }
        }
        if (selections_1.length + selections_2.length < current_added) {
            DATA.set(COPY);
            update_all_cells_display();

            const text_31 = 'reset failed';
            test_result_text += text_31 + '<br>';
            console.warn(text_31);

            send_notice('reset_failed', false);
            send_test_result_notice(test_result_text);
            return false;
        }
        if (selections_1.length < current_added) {
            const difference = current_added - selections_1.length;
            for (let i = 0; i < difference; i++) {
                const rj = i + (Math.random() * (selections_2.length - i)) | 0;
                const temp = selections_2[i];
                selections_2[i] = selections_2[rj];
                selections_2[rj] = temp;

                selections_1.push(selections_2[i]);
            }
        } else {
            for (let i = 0; i < current_added; i++) {
                const rj = i + (Math.random() * (selections_1.length - i)) | 0;
                const temp = selections_1[i];
                selections_1[i] = selections_1[rj];
                selections_1[rj] = temp;
            }
        }
        for (let i = 0; i < current_added; i++) {
            const index = selections_1[i];
            const ix = (index / Y) | 0;
            const iy = index - ix * Y
            removed_candidate_list_3 += `[${ix},${iy}] `
            remove_mine(index);
        }
        const text_32 = `3.Phase removed ${current_added}: <br>${removed_candidate_list_3}`
        test_result_text += text_32 + '<br>'
        console.warn(text_32);
    }

    if (current_removed > 0) {
        const selections_1 = [];
        const selections_2 = [];
        for (let i = 0; i < X * Y; i++) {
            if ((DATA[i] & Cv_) && !(DATA[i] & Mi_) && i !== target_mine) {
                const ix = (i / Y) | 0;
                const iy = i - ix * Y;
                let valid = true;
                for (let n = 0; n < 8; n++) {
                    const x = ix + DX[n];
                    const y = iy + DY[n];
                    if (x >= 0 && x < X && y >= 0 && y < Y) {
                        if (!(DATA[x * Y + y] & Cv_)) {
                            valid = false;
                            break;
                        }
                    }
                }
                if (valid) {
                    selections_1.push(i);
                } else {
                    selections_2.push(i);
                }
            }
        }
        if (selections_1.length + selections_2.length < current_removed) {
            DATA.set(COPY);
            update_all_cells_display();

            const text_33 = 'reset failed';
            test_result_text += text_33 + '<br>';
            console.warn(text_33);

            send_notice('reset_failed', false);
            send_test_result_notice(test_result_text);
            return false;
        }
        if (selections_1.length < current_removed) {
            const difference = current_removed - selections_1.length;
            for (let i = 0; i < difference; i++) {
                const rj = i + (Math.random() * (selections_2.length - i)) | 0;
                const temp = selections_2[i];
                selections_2[i] = selections_2[rj];
                selections_2[rj] = temp;

                selections_1.push(selections_2[i]);
            }
        } else {
            for (let i = 0; i < current_removed; i++) {
                const rj = i + (Math.random() * (selections_1.length - i)) | 0;
                const temp = selections_1[i];
                selections_1[i] = selections_1[rj];
                selections_1[rj] = temp;
            }
        }
        for (let i = 0; i < current_removed; i++) {
            const index = selections_1[i];
            const ix = (index / Y) | 0;
            const iy = index - ix * Y
            added_candidate_list_3 += `[${ix},${iy}] `
            set_mine(index);
        }
        const text_34 = `3.Phase added ${current_removed}: <br>${added_candidate_list_3}`
        test_result_text += text_34 + '<br>'
        console.warn(text_34);
    }
    // 3.Phase End


    for (let i = 0; i < X * Y; i++) {
        if ((DATA[i] & Nr_) === 0 && !(DATA[i] & Cv_)) {
            const ix = (i / Y) | 0;
            const iy = i - ix * Y;
            for (let n = 0; n < 8; n++) {
                const x = ix + DX[n];
                const y = iy + DY[n];
                if (x >= 0 && x < X && y >= 0 && y < Y) {
                    if (DATA[x * Y + y] & Cv_) {
                        select_cell(x * Y + y);
                    }
                }
            }
        }
    }

    module_collection.length = 0;
    solutions = new Uint32Array(bitmap_size).fill(0);
    update_mines_visibility();
    clear_all_internal_mark();

    const text_end = 'reset complete';
    test_result_text += text_end + '<br>';
    console.warn(text_end);

    send_notice('reset_complete', false);
    send_test_result_notice(test_result_text);
    return true;
}
function recursive_add_mines(COPY, linked_number_cells, linked_covered_cells, i = 0) {
    if (i === linked_covered_cells.length) {
        return partially_eq(COPY, linked_number_cells);
    }

    if (recursive_add_mines(COPY, linked_number_cells, linked_covered_cells, i + 1)) {
        return true;
    }

    const index = linked_covered_cells[i];
    set_mine(index);
    if (partially_leq(COPY, linked_number_cells)) {
        if (recursive_add_mines(COPY, linked_number_cells, linked_covered_cells, i + 1)) {
            return true;
        }
    }
    remove_mine(index);
    return false;
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
function set_mine(index) {
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
function clear_all_internal_mark() {
    for (let i = 0; i < X * Y; i++) {
        DATA[i] &= ~Mk_;
    }
}
function count_number_of_mines() {
    let counter = 0;
    for (let i = 0; i < X * Y; i++) {
        if (DATA[i] & Mi_) {
            counter++;
        }
    }
    return counter;
}
function partially_eq(COPY, linked_number_cells) {
    for (const index of linked_number_cells) {
        if ((DATA[index] & Nr_) !== (COPY[index] & Nr_)) {
            return false;
        }
    }
    return true;
}
function partially_leq(COPY, linked_number_cells) {
    for (const index of linked_number_cells) {
        if ((DATA[index] & Nr_) > (COPY[index] & Nr_)) {
            return false;
        }
    }
    return true;
}
// Todo 1.6 - Administrator Function
function activate_algorithm() {
    algorithm_enabled = true;
    update_solvability_info();
    send_notice('alg_activated');
    console.warn("Algorithm activated.");
}
function deactivate_algorithm() {
    algorithm_enabled = false;
    update_solvability_info();
    send_notice('alg_deactivated');
    console.warn("Algorithm deactivated.");
}
function toggle_mines_visibility() {
    const ans_btn = document.getElementById('ans-btn');
    const answer_btn = document.getElementById('answer-btn');
    if (ans_btn === null) {
        return;
    }
    if (ans_btn.classList.contains('selected')) {
        ans_btn.classList.remove('selected');
        answer_btn.classList.remove('selected');
        for (let i = 0; i < X * Y; i++) {
            CELL_ELEMENTS[i].classList.remove('ans');
        }
    } else {
        ans_btn.classList.add('selected');
        answer_btn.classList.add('selected');
        for (let i = 0; i < X * Y; i++) {
            if (DATA[i] & Mi_) {
                CELL_ELEMENTS[i].classList.add('ans');
            }
        }
    }
}
function update_mines_visibility() {
    const ans_button = document.getElementById('ans-btn');
    if (ans_button === null) return;
    if (current_test_id === null) return;

    if (ans_button.classList.contains('selected')) {
        for (let i = 0; i < X * Y; i++) {
            if (DATA[i] & Mi_) {
                CELL_ELEMENTS[i].classList.add('ans');
            } else {
                CELL_ELEMENTS[i].classList.remove('ans');
            }
        }
    } else {
        for (let i = 0; i < X * Y; i++) {
            CELL_ELEMENTS[i].classList.remove('ans');
        }
    }
}
// Todo 1.7 - Test Mode
function start_test(target_test_id) {
    current_test_id = target_test_id;
    start();
    update_test_selection();
}
function select_previous_test() {
    current_test_id--;
    if (current_test_id === 0) {
        current_test_id = Object.keys(TEST_CONFIG).length;
    }
    start();
    update_test_selection();
}
function select_next_test() {
    current_test_id++;
    if (current_test_id > Object.keys(TEST_CONFIG).length) {
        current_test_id = 1;
    }
    start();
    update_test_selection();
}
function test() {
    current_test_id = 1;
    cursor_enabled = false;

    generate_test_ui();
    adjust_sidebar_buttons();
    update_test_selection();
    send_notice('test_start', false);
    start();
}
function exit_test() {
    current_test_id = null;
    document.getElementById('answer-btn').classList.remove('selected');

    close_test_ui();
    adjust_sidebar_buttons();
    send_notice('test_end', false);
    start();
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
    border.style.display = 'block';

    const border_outline = document.getElementById('border-outline');
    border_outline.style.width = `${width + 2 * BORDER_OFFSET_OUTLINE}px`;
    border_outline.style.height = `${height + 2 * BORDER_OFFSET_OUTLINE}px`;
    border_outline.style.left = `${-BORDER_OFFSET_OUTLINE}px`;
    border_outline.style.top = `${-BORDER_OFFSET_OUTLINE}px`;
    border_outline.style.display = 'block';
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
        div.dataset.index = i.toString();
        div.addEventListener("click", () => select_cell(i));
        div.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            mark_cell(i);
        });
        board_element.appendChild(div);
        CELL_ELEMENTS[i] = div;
    }
}
function format_number(n) {
    if (n === 0) {
        return ' ';
    }
    if (n >= 1 && n <= 9) {
        return n.toString();
    }
    if (n >= 10 && n <= 35) {
        return String.fromCharCode(65 + (n - 10));
    }
    return '?';
}
function format_time(timestamp, used_in_filename = false) {
    let date = new Date(timestamp);
    let Y = date.getFullYear();
    let M = String(date.getMonth() + 1).padStart(2, '0');
    let D = String(date.getDate()).padStart(2, '0');
    let h = String(date.getHours()).padStart(2, '0');
    let m = String(date.getMinutes()).padStart(2, '0');
    let s = String(date.getSeconds()).padStart(2, '0');
    if (used_in_filename) {
        return `${Y}_${M}_${D}_${h}_${m}_${s}`;
    } else {
        return `${h}:${m}:${s} / ${Y}.${M}.${D}`;
    }
}
function play_start_animation(max_delay = 1000) {
    if (X * Y > ANIMATION_LIMIT) {
        send_notice("animation_off");
        return;
    }
    animation_timers.length = 0;
    hide_all_cells();

    max_delay = Math.min(max_delay, Y * 16);
    let delay = max_delay;
    let left_pivot = 0;
    let right_pivot = Y - 1;
    while (left_pivot <= right_pivot) {
        const current_left = left_pivot;
        const current_right = right_pivot;
        const current_delay = delay;

        const timer = setTimeout(() => {
            animate_double_columns(current_left, current_right);
        }, current_delay);
        animation_timers.push(timer);

        delay = (delay * 0.9 + 1) | 0;
        left_pivot++;
        right_pivot--;
    }

    const end_timer = setTimeout(() => {
        cleanup_animation();
        clear_all_animation_timers();
    }, max_delay + 100);
    animation_timers.push(end_timer);
}
function animate_double_columns(left, right) {
    if (left === right) {
        for (let x = 0; x < X; x++) {
            const cell = CELL_ELEMENTS[x * Y + left];
            cell.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            cell.style.opacity = '1';
            cell.style.transform = 'scale(1)';
        }
    } else {
        for (let x = 0; x < X; x++) {
            const cell_left = CELL_ELEMENTS[x * Y + left];
            const cell_right = CELL_ELEMENTS[x * Y + right];
            cell_left.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            cell_right.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            cell_left.style.opacity = '1';
            cell_right.style.opacity = '1';
            cell_left.style.transform = 'scale(1)';
            cell_right.style.transform = 'scale(1)';
        }
    }
}
function hide_all_cells() {
    for (let i = 0; i < X * Y; i++) {
        const cell = CELL_ELEMENTS[i];
        cell.style.opacity = '0';
        cell.style.transform = 'scale(0.2)';
        cell.style.transition = 'none';
        cell.style.willChange = 'opacity, transform';
    }
}
function clear_all_animation_timers() {
    animation_timers.forEach(timer => {
        clearTimeout(timer);
        clearInterval(timer);
    });
    animation_timers.length = 0;
}
function cleanup_animation() {
    for (let i = 0; i < X * Y; i++) {
        CELL_ELEMENTS[i].style.willChange = 'auto';
    }
}
function preload_backgrounds() {
    const path = 'Background_Collection/';
    const resources = [
        '01.jpg',
        '02.jpg',
        '03.jpg',
        '04.jpg',
        '05.jpg',
    ];
    setTimeout(() => {
        resources.forEach(resource => {
            new Image().src = path + resource;
            console.log(`Loaded Background ${resource}`);
        })
    }, 1000);
}
// Todo 2.2 - Edit Game Status
function set_difficulty(difficulty) {
    current_difficulty = difficulty;
    start();
    close_difficulty_menu();
}
function set_background(filename, title_image = 'dark') {
    document.documentElement.style.setProperty('--background-url', `url("Background_Collection/${filename}")`);
    if (title_image === 'light') {
        document.getElementById("title-dark").style.display = `none`;
        document.getElementById("title-light").style.display = `block`;
    } else {
        document.getElementById("title-dark").style.display = `block`;
        document.getElementById("title-light").style.display = `none`;
    }
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
        target_element.textContent = number > 0 ? number.toString() : ' ';
        target_element.classList.add('revealed');
    }
}
function update_all_cells_display() {
    for (let i = 0; i < X * Y; i++) {
        update_cell_display(i);
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
function update_cursor() {
    CELL_ELEMENTS[cursor_path].classList.remove('cursor');
    if (cursor_enabled) {
        const target_element = CELL_ELEMENTS[cursor_x * Y + cursor_y];
        target_element.classList.add('cursor');
    }
}
// Todo 2.4 - Message / Shortcuts
function send_notice(type, locked = true) {
    const now = Date.now();
    if (locked) {
        if (locked && now - last_notice_time < NOTICE_TIME_LIMIT) {
            return;
        }
        last_notice_time = now;
    }

    const { text, color } = NOTICE_CONFIG[type] || NOTICE_CONFIG.default;

    const container = document.getElementById('notice-container');
    const notice = document.createElement('div');
    const notice_text = document.createElement('div');
    const notice_progress = document.createElement('div');

    notice.classList.add('notice');
    notice_text.classList.add('notice-text');
    notice_progress.classList.add('notice-progress');

    notice_text.innerHTML = text;
    notice_progress.style.backgroundColor = color;
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
function send_test_result_notice(text) {
    if (current_test_id === null) {
        return;
    }
    const container = document.getElementById('notice-container');
    const test_result_notice = document.createElement('div');
    const notice_text = document.createElement('div');

    test_result_notice.classList.add('notice', 'test-result');
    notice_text.classList.add('notice-text');
    notice_text.innerHTML = text + format_time(Date.now());
    test_result_notice.appendChild(notice_text);

    test_result_notice.onclick = () => {
        if (container.contains(test_result_notice)) {
            container.removeChild(test_result_notice);
        }
    };
    test_result_notice.style.animation = 'slideInRight 0.3s ease forwards';

    container.appendChild(test_result_notice);
}
function handle_keydown(event) {
    const key = event.key.toLowerCase();
    const shift_enabled = event.shiftKey;

    if (current_test_id !== null) {
        switch (key) {
            case 'r':
                start_test(current_test_id);
                return;
            case 'escape':
                exit_test();
                return;
            case ' ':
                toggle_mines_visibility();
                break;
            case 'arrowright':
            case 'arrowdown':
                select_next_test();
                break;
            case 'arrowleft':
            case 'arrowup':
                select_previous_test();
                break;
        }
        return;
    }

    switch (key) {
        case 'escape':
            close_guide_with_button();
            close_difficulty_menu();
            close_background_menu();
            return;
        case 'c':
            toggle_sidebar();
            return;
        case 'f':
            if (!shift_enabled) {
                return;
            }
            cursor_enabled = !cursor_enabled;
            const cell = CELL_ELEMENTS[cursor_x * Y + cursor_y];
            cell.classList.toggle('cursor', cursor_enabled);
            return;
        case 'r':
            start();
            return;
        case 'h':
            send_hint();
            break;
        case 't':
            if (shift_enabled) { test(); }
            break;
        case '0':
            solve();
            break;
    }

    if (!cursor_enabled) {
        return;
    }

    const step = shift_enabled ? 4 : 1;
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
    update_cursor();
}
// Todo 2.5 - Sidebar
function toggle_sidebar() {
    document.body.classList.toggle('sidebar-collapsed');
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
function open_guide() {
    document.getElementById('guide-modal').style.display = 'block';
}
function close_guide_with_button() {
    document.getElementById('guide-modal').style.display = 'none';
    document.getElementById('guide-btn').classList.remove('selected');
}
function close_guide(event) {
    const content = document.getElementById('guide-content');
    if (!content.contains(event.target)) {
        close_guide_with_button();
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
// Todo 2.6 - Text Copy
function copy_to_clipboard(text) {
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
// Todo 2.7 - Screenshot
async function screenshot_data(candidate = true) {
    await document.fonts.ready;

    const indent_a = 4;
    const indent_b = 8;
    const width = candidate ?
        (Y + 1) * CELL_SIZE + indent_b * 2 : Y * CELL_SIZE + indent_b * 2;
    const height =  candidate ?
        (X + 1) * CELL_SIZE + indent_b * 2 : X * CELL_SIZE + indent_b * 2;
    let start_x = indent_b;
    let start_y = indent_b;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${FONT_SIZE}px Tahoma, 'Microsoft Sans Serif', Arial, sans-serif`;

    ctx.fillStyle = "rgba(255, 255, 255, 1)"
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (candidate) {
        ctx.fillStyle = 'rgba(0, 0, 0, 1)';
        ctx.font = `bold ${FONT_SIZE}px Tahoma, 'Microsoft Sans Serif', Arial, sans-serif`;
        for (let x = 0; x < X + 1; x++) {
            const text = format_candidate(x, 0);
            const x_ = start_y - indent_a + CELL_SIZE / 2;
            const y_ = start_x + CELL_SIZE * x + CELL_SIZE / 2 + 1;
            ctx.fillText(text, x_, y_);
        }
        start_y += CELL_SIZE;
        for (let y = 0; y < Y; y++) {
            const text = format_candidate(0, y + 1);
            const x_ = start_y + CELL_SIZE * y + CELL_SIZE / 2;
            const y_ = start_x + CELL_SIZE / 2 + 1;
            ctx.fillText(text, x_, y_);
        }
        start_x += CELL_SIZE;
    }

    for (let x = 0; x < X; x++) {
        for (let y = 0; y < Y; y++) {
            const cell_element = CELL_ELEMENTS[x * Y + y];
            const px = start_x + CELL_SIZE * x;
            const py = start_y + CELL_SIZE * y;

            if (cell_element.classList.contains('ans')) {
                ctx.fillStyle = 'rgba(140, 18, 18, 1)';
                ctx.strokeStyle = 'rgba(157, 99, 99, 1)';
            } else if (cell_element.classList.contains('revealed')) {
                ctx.fillStyle = 'rgba(128, 128, 128, 1)';
                ctx.strokeStyle = 'rgba(166, 166, 166, 1)';
            } else {
                ctx.fillStyle = 'rgba(25, 25, 25, 1)';
                ctx.strokeStyle = 'rgba(94, 94, 94, 1)';
            }
            ctx.fillRect(py, px, CELL_SIZE, CELL_SIZE);
            ctx.lineWidth = 1;
            ctx.strokeRect(py + 0.5, px + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);

            const text = cell_element.textContent ? cell_element.textContent.toString() : " ";
            const x_ = py + CELL_SIZE / 2;
            const y_ = px + CELL_SIZE / 2 + 1;
            ctx.fillStyle = "rgba(255, 255, 255, 1)";
            ctx.fillText(text, x_, y_);
        }
    }

    canvas.toBlob(blob => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `minesweeper_${format_time(Date.now(), true)}.png`;
        link.click();
    });

    send_notice('screenshot');
}
function format_candidate(x, y) {
    if (x === 0 && y === 0) {
        return ' ';
    } else if (x === 0) {
        if (y > 0 && y <= 26) {
            return String.fromCharCode(64 + y);
        } else if (y > 26 && y <= 52) {
            return String.fromCharCode(70 + y);
        } else {
            return '?';
        }
    } else if (y === 0) {
        if (x > 0 && x < 10) {
            return ' ' + x.toString();
        } else if (x < 100) {
            return x.toString();
        } else {
            return ' ?';
        }
    } else {
        return ' ';
    }
}
// Todo 2.8 - Test Mode UI
function generate_test_ui() {
    document.getElementById(`main-test-container`).style.display = 'flex';
    const container = document.getElementById("test-container");
    container.innerHTML = '';
    container.style.display = 'grid';
    for (let key = 1; key <= TEST_SIZE; key++) {
        const test_option = document.createElement('div');
        test_option.classList.add('test-option');
        test_option.innerHTML = `${format_number(key)}`;
        test_option.onclick = () => {
            start_test(key);
        };
        container.appendChild(test_option);
    }

    const ans_button = document.createElement('div');
    ans_button.id = 'ans-btn';
    ans_button.classList.add('test-option', 'ctrl');
    ans_button.innerHTML = 'Ans';
    ans_button.onclick = () => {
        toggle_mines_visibility();
    };
    container.appendChild(ans_button);

    const exit_test_button = document.createElement('div');
    exit_test_button.id = 'exit-test-button';
    exit_test_button.classList.add('test-option', 'ctrl');
    exit_test_button.innerHTML = 'Exit';
    exit_test_button.onclick = () => {
        exit_test();
    };
    container.appendChild(exit_test_button);
}
function close_test_ui() {
    document.getElementById(`main-test-container`).style.display = `none`;
    document.getElementById("test-container").innerHTML = '';
}
function adjust_sidebar_buttons() {
    close_difficulty_menu();
    close_background_menu();

    for (const button_id of [
        'difficulty-btn', 'mark-btn', 'hint-btn', 'solve-btn', 'solve-all-btn', 'guide-btn',
        'answer-btn', 'exit-btn'
    ]) {
        const target_button = document.getElementById(button_id);
        target_button.style.display = target_button.style.display === 'none' ? 'block' : 'none';
    }
}
function update_test_selection() {
    document.querySelectorAll('.test-option:not(.ctrl)').forEach(option => {
        const testId = option.textContent.trim();
        if (testId === format_number(current_test_id)) {
            option.classList.add('selected');
        } else {
            option.classList.remove('selected');
        }
    });
}



// < Part 3 - Init / Load >

// Todo 3.1 - Init Game / Load Monitor
document.addEventListener('keydown', handle_keydown);
preload_backgrounds();
start();