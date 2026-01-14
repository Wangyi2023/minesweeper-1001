// < PART 0 - DEFINE GLOBAL-VARIABLES >

/*
X 为矩阵的行数，Y 为列数，N 为雷的数量，DATA 为存储矩阵信息的高密度容器，是游戏的核心数据，数据类型为 Uint8Array。
存储矩阵信息的方式为，将存储单个方格（Cell）的二维矩阵扁平化为一维数组，用 8 位存储单个格子的全部信息，具体信息分布在下面表格中。
这一存储 DATA 的方式是优化到极限的，在高频访问时对缓存极其友好，并且在更改和读取内部数据的时候全部使用位运算，速度极快。
而 CELL_ELEMENTS 只用于存储单个方格对应的页面上的元素（div）的索引，只用于渲染游戏界面。
它无法被 Uint8Array 压缩，只能用普通数组存储。
它的作用是在局部更新游戏界面时快速寻找到需要渲染的方格，而不必频繁调用缓慢的 querySelector。
 */
let X, Y, N, DATA, CELL_ELEMENTS;
/*
以下是我设计的用 8 位存储单个方格的全部信息的方式
-----------------------------------------------------------------------------------------
| internal-mark-solution   | internal-mark-mine   | covered   | mine   | number (0-8)   |
| bit 7                    | bit 6                | bit 5     | bit 4  | bit 0-3        |
-----------------------------------------------------------------------------------------
由于 number 这一项信息的数据类型为 int，我选择把它放到最低位，这样只需掩码位运算就可获取到 int 以及更改它的值。如果放在高位
需要额外的左移和右移运算。在游戏中它的值为 0-8，因此只需要 4 bit 的位置即可存储这项信息。
其它元素均为 boolean，随意放置不影响性能。
其中 internal-mark-solution 和 internal-mark-mine 是内部标记，用于内部算法计算。与 mark 外部标记不同，外部标记由玩家操控，
用于辅助玩家完成游戏，因此外部标记不需要存储到 DATA 中，而是以 'marked' 属性存储在 CELL_ELEMENTS 对应元素的 ClassList 中，
对其的更改不会影响核心数据。
通过与掩码位运算可提取和修改它们的各项信息，如下：
DATA[x * Y + y] & NUMBER_MASK     <-> number on the cell (x, y)
DATA[x * Y + y] & MINE_MASK       <-> cell (x, y) is mine
DATA[x * Y + y] & COVERED_MASK    <-> cell (x, y) is covered
 */
const Nr_ = 0b00001111;
const Mi_ = 0b00010000;
const Cv_ = 0b00100000;
const Im_ = 0b01000000;
const Is_ = 0b10000000;
/*
游戏 ID 的作用是：在一些延迟操作中，若操作未结束时玩家强行重设棋盘，尚未完成的延时操作会在重设后由于 ID 的改变被迫中断。
 */
let ID = 0;
/*
DX 和 DY 的作用是快速获取和遍历一个坐标的所有周围坐标。为满足特殊需求比如有时只需要分析上下左右的方向，我已将上下左右的坐标
放置于前 4 位，可快速截断。整体遍历顺序为顺时针方向，这仅仅是为了优化延迟展开的效果。
 */
const DX = [-1, 0, 1, 0, -1, 1, 1, -1];
const DY = [0, 1, 0, -1, 1, 1, -1, -1];
/*
这里是测试列表，在测试重置算法的测试模式中会创建 8x8 的使用预设方式排布雷的测试棋盘，并自动打开右上角 (7, 0) 坐标。
测试通过快捷键 shift + t 或在控制台使用 test() 函数调用，以下测试主要用于检测 reset_mines 功能。
 */
const TEST_CONFIG = {
    1  : { Type: 1, Mines: [[0, 0], [2, 0], [2, 1]] },
    2  : { Type: 1, Mines: [[0, 0], [0, 1], [2, 0], [2, 1]] },
    3  : { Type: 1, Mines: [[0, 1], [1, 0], [2, 1], [3, 0], [3, 1]] },
    4  : { Type: 2, Mines: [[0, 0], [2, 0], [3, 0], [5, 0], [5, 1]] },
    5  : { Type: 2, Mines: [[0, 0], [2, 0], [3, 0], [5, 0], [6, 0], [7, 2], [7, 3], [7, 5], [7, 6]] },
    6  : { Type: 2, Mines: [[0, 0], [1, 1], [2, 2]] },
    7  : { Type: 2, Mines: [[0, 1], [1, 0], [2, 2]] },
    8  : { Type: 3, Mines: [[1, 2], [2, 0], [3, 1], [3, 2], [4, 0], [5, 2]] },
    9  : { Type: 3, Mines: [[1, 2], [2, 1], [3, 0], [3, 2], [4, 1], [5, 2]] },
    10 : { Type: 3, Mines: [[0, 1], [1, 0], [2, 2], [5, 5], [6, 7], [7, 6]] },
    11 : { Type: 3, Mines: [[0, 0], [0, 1], [1, 0], [2, 2], [5, 5], [6, 6], [7, 7]] },
    12 : { Type: 3, Mines: [[0, 0], [0, 1], [1, 0], [2, 2], [5, 5], [6, 6]] },
    13 : { Type: 4, Mines: [[0, 0], [0, 2], [1, 1], [2, 1], [4, 1], [4, 2], [5, 0], [5, 1], [5, 2]] },
    14 : { Type: 4, Mines: [[0, 1], [0, 2], [1, 1], [3, 1], [4, 1], [4, 2], [5, 0], [5, 1], [5, 2]] },
    15 : { Type: 5, Mines: [[0, 0], [0, 2], [2, 1], [4, 2], [5, 0], [5, 1], [5, 2]] },
    16 : { Type: 5, Mines: [[0, 1], [0, 2], [3, 1], [4, 2], [5, 0], [5, 1], [5, 2]] },
}
const TEST_SIZE = Object.keys(TEST_CONFIG).length;
/*
这里是预设的消息列表，普通消息的内容和进度条的颜色在此编辑。特殊的 Test Result Notice 没有预设的标题和内容，可以在调用
函数的时候自由编辑。
 */
const NOTICE_CONFIG = {
    default: {
        title: "Notice.",
        content: "Default Notice Content - 1024 0024.",
        color: 'rgba(0, 150, 255, 1)'
    },
    congrats: {
        title: "Congratulations.",
        content: "You've successfully completed Minesweeper.",
        color: 'rgba(0, 220, 80, 1)'
    },
    failed: {
        title: "Failed.",
        content: "You triggered a mine.",
        color: 'rgba(255, 20, 53, 1)'
    },
    reset_complete: {
        title: "Reset Complete.",
        content: null,
        color: 'rgba(0, 220, 80, 1)'
    },
    reset_failed: {
        title: "Reset Failed.",
        content: null,
        color: 'rgba(255, 20, 53, 1)'
    },
    test_start: {
        title: "Test Mode Activated.",
        content: "Sidebar adjusted, shortcuts disabled, background locked to default.",
        color: 'rgba(0, 150, 255, 1)'
    },
    test_end: {
        title: "Test Mode Deactivated.",
        content: "Sidebar adjusted, shortcuts enabled, background unlocked.",
        color: 'rgba(0, 150, 255, 1)'
    },
    copied: {
        title: "Hint.",
        content: "Email address copied to clipboard.",
        color: 'rgba(0, 150, 255, 1)'
    },
    animation_off: {
        title: "Animation OFF.",
        content: "Animation turned off for better performance on large boards.",
        color: 'rgba(255, 230, 0, 1)'
    },
    screenshot: {
        title: "Screenshot Completed.",
        content: "Screenshot saved to default folder",
        color: 'rgba(0, 220, 80, 1)'
    },
    progression_blocked: {
        title: "Progression Blocked.",
        content: "Progression blocked by algorithm divergence. Please update the verifier solution via the 'Analyse' button, or restart the game.",
        color: 'rgba(255, 20, 53, 1)'
    }
};
/*
这里是用于计算位图大小的表格，对于此项目中出现的位图，可以使用查表法在极短的时间内统计位图中 1 的数量。
 */
const BIT_COUNT_8 = new Uint8Array(256);
for (let i = 1; i < 256; i++) {
    BIT_COUNT_8[i] = (i & 1) + BIT_COUNT_8[i >> 1];
}

const CELL_SIZE = 24;
const FONT_SIZE = 16;
const ANIMATION_LIMIT = 1200;
const NOTICE_TIME_LIMIT = 800;
const REVEAL_DELAY = 4;
const REVEAL_DELAY_LIMIT = 200;
const AUTO_SOLVE_INTERVAL = 100;
const AUTO_SOLVING_TEST_INTERVAL = 800;
const NOTICE_DISPLAY_TIME = 4500;
const RESET_RECURSION_LIMIT = 12;

let current_difficulty = 'high';
let current_test_id = null;

let first_click = true;
let mines_inited = true;
let game_over = false;
let is_solving = false;
let is_testing = false;
let solvable = false;

let animation_timers = [];
let start_time = null;
let timer_interval = null;
let last_notice_time = 0;

let cursor_enabled = false;
let mines_visible = false;

let module_collection;
let bitmap_size;
let solutions;
let solutions_verifier;

let total_module_calculation_time;
let total_module_calculation_calls;

let counter_covered, counter_marked;
let cursor_x, cursor_y, cursor_path;



// < PART 1 - CORE GAME MECHANICS >

// Todo 1.1 - Game Initialization & Setup
function start() {
    ID++;
    clear_all_animation_timers();

    if (current_test_id > 0) {
        const params = TEST_CONFIG[current_test_id];
        X = 8;
        Y = 8;
        N = params.Mines.length;
        mines_inited = true;
        init_board_data();

        for (const [x, y] of params.Mines) {
            set_mine(x * Y + y);
        }
        setTimeout(() => {select_cell(7)}, 50);
    } else if (current_test_id === 0) {
        const params = get_difficulty_params();
        X = params.X;
        Y = params.Y;
        N = params.N;
        mines_inited = false;
        init_board_data();
    } else {
        const params = get_difficulty_params(current_difficulty);
        X = params.X;
        Y = params.Y;
        N = params.N;
        mines_inited = false;
        init_board_data();
    }

    first_click = true;
    game_over = false;
    is_solving = false;
    is_testing = false;
    solvable = false;
    counter_covered = X * Y;
    counter_marked = 0;

    bitmap_size = Math.ceil(X * Y / 32) + 1;
    solutions = new Uint32Array(bitmap_size).fill(0);
    solutions_verifier = new Uint32Array(bitmap_size).fill(0);
    init_module_collection();

    cursor_x = (X / 3) | 0;
    cursor_y = (Y / 3) | 0;
    cursor_path = cursor_x * Y + cursor_y;

    start_time = null;
    clearInterval(timer_interval);

    generate_game_field();
    render_border();
    init_information_box();
    update_solvability_info();
    update_mines_visibility();
    update_cursor();
    play_start_animation();
}
function init_board_data() {
    /*
    此函数的作用仅仅是初始化棋盘，但不添加雷，目的是在玩家选择第一个格子后再调用 init_mines() 函数确认雷的位置。
     */
    DATA = new Uint8Array(X * Y).fill(Cv_);
}
function init_mines(target_number_of_mines, position_first_click) {
    /*
    此函数的作用是随机摆放雷的位置，position_first_click 为输入的赦免坐标，确保雷不会摆放到此坐标及其相邻坐标，方式如下：
    创建一个 Uint32Array 用作打乱后的指针列表，将需要赦免的坐标依次交换到数组最后，然后打乱除赦免坐标的部分，最后取前 n 个坐标
    将其全部设为雷，并同步更新每一个雷及其周围元素的信息。
    注意这里使用了一些优化方式，首先所谓的交换实际上是直接把后面的数字取出然后覆盖到赦免坐标的 index 上，因为最后的几个坐标是
    需要完全忽视的，也就是 index >= size 的坐标，它们的值是无意义的，更改 size 即可将其视为数组的无效数据部分。
    其次打乱时真正被有效打乱的是前 n 个最后需要被放置雷的坐标，对于第 i 个坐标，会取任意一个在 [i, size) 之间的坐标与之交换，
    这个操作截至到 size 就结束了，后面的数据只会与更靠后的数据交换，所以打乱没有意义。
    其次摆放雷的时候不需要使用规范的 set_mine() 函数，因为所有方格目前都在未打开状态，不需要更新页面的渲染。
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
            const x = Math.min(((window.innerHeight - 100) / (CELL_SIZE + 2)) | 0, 100);
            const y = Math.min(((window.innerWidth - 20) / (CELL_SIZE + 2)) | 0, 200);
            const n = ( x * y * 0.20625) | 0;
            return { X: x, Y: y, N: n };
        default:
            return { X: 16, Y: 30, N: 99 };
    }
}
function remove_mine(index) {
    DATA[index] &= ~Mi_;
    update_cell_information_from_data(index);
    const idx = (index / Y) | 0;
    const idy = index - idx * Y;
    for (let n = 0; n < 8; n++) {
        const x = idx + DX[n];
        const y = idy + DY[n];
        if (x >= 0 && x < X && y >= 0 && y < Y) {
            const i = x * Y + y;
            DATA[i]--;
            update_cell_information_from_data(i);
        }
    }
}
function set_mine(index) {
    DATA[index] |= Mi_;
    update_cell_information_from_data(index);
    const idx = (index / Y) | 0;
    const idy = index - idx * Y;
    for (let n = 0; n < 8; n++) {
        const x = idx + DX[n];
        const y = idy + DY[n];
        if (x >= 0 && x < X && y >= 0 && y < Y) {
            const i = x * Y + y;
            DATA[i]++;
            update_cell_information_from_data(i);
        }
    }
}
function count_current_mines() {
    let counter = 0;
    for (let i = 0; i < X * Y; i++) {
        if (DATA[i] & Mi_) {
            counter++;
        }
    }
    return counter;
}
// Todo 1.2 - Game State Transition Management
function select_cell(i) {
    /*
    这是玩家层面的选择方格函数，它会先过滤一些特殊情况，然后计算当玩家点击一个坐标时真正需要打开的坐标的列表，
    再调用规范的 admin_reveal_cells() 函数打开列表中的坐标。
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

    if (!mines_inited) {
        init_mines(N, i);
        update_mines_visibility();
        mines_inited = true;
    }
    if (first_click) {
        start_timer();
        document.getElementById('status-info').textContent = 'In Progress';
        first_click = false;
    }
    if (!solvable && (DATA[i] & Mi_)) {
        reset_mines(i);
    }

    const reveal_sequence = calculate_reveal_sequence([i]);
    admin_reveal_cells(reveal_sequence, ID);
}
function calculate_reveal_sequence(input_queue) {
    const visited = new Set();
    for (const i of input_queue) {
        visited.add(i);
    }

    let index = 0;
    while (index < input_queue.length) {
        const j = input_queue[index];
        index++;

        if (DATA[j] & Mi_) {
            continue;
        }
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
                if (!visited.has(k)) {
                    input_queue.push(k);
                    visited.add(k);
                }
            }
        }
    }
    return input_queue;
}
function admin_reveal_cells(reveal_sequence, current_id) {
    /*
    注意！所有 reveal cell 的行为必须通过此 admin_reveal_cells 函数，游戏状态的检测和修改都在此函数内，此处为分界线。
    算法也统一在此处更新，因为每次棋盘内容有变动都需要及时更新可解性（solvability）信息。
    为了避免单次操作造成多个坐标被分别打开而造成算力的浪费，此函数吸收的不是单个坐标而是坐标列表，可以实现批量打开坐标的同时
    仅进行单次的消耗大量算力的计算。
    此外，此函数在 reveal cell 的过程中实现了动画与核心数据分别更新，此功能是为了在批量打开坐标的过程中既满足只进行单次消
    耗算力的计算，又满足部分动画延迟播放的设计需求。
     */
    if (game_over) {
        return;
    }
    if (current_id !== ID) {
        return;
    }
    for (const i of reveal_sequence) {
        if (DATA[i] & Cv_) {
            DATA[i] &= ~Cv_;
            counter_covered--;
            remove_cell_from_solutions(i);

            if (DATA[i] & Mi_) {
                terminate(false);
            } else if (counter_covered === N) {
                terminate(true);
            }
        }
    }

    if (!game_over) {
        for (const i of reveal_sequence) {
            init_module(i);
        }
        remove_opened_cells_from_module_collection(reveal_sequence);
        calculate_complete_module_collection();
    }

    update_solvability_info();
    play_reveal_cells_animation(reveal_sequence, ID);
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
    log_algorithm_performance();
}
// Todo 1.3 - Administrator Function
function toggle_mines_visibility() {
    mines_visible = !mines_visible;
    update_mines_visibility();
    update_ans_button_selection();
}
function notice_test() {
    /*
    此函数的作用是测试发送消息的功能是否正常，运行后会将各类别消息各发送一次。
     */
    let time_out = 0;
    Object.keys(NOTICE_CONFIG).forEach(type => {
        setTimeout(() => {
            send_notice(type, false);
        }, time_out);
        time_out += 500;
    });
    setTimeout(() => {
        send_test_result_notice("1024 0024<br>");
    }, time_out)
}
// Todo 1.4 - Test Mode
function test() {
    cursor_enabled = false;

    set_background();
    send_notice('test_start', false);
    solving_test();
}
function exit_test() {
    current_test_id = null;
    mines_visible = false;

    update_ans_button_selection();
    close_solving_test_ui();
    close_reset_test_ui();
    update_sidebar_buttons();
    send_notice('test_end', false);
    start();
}
// Todo 1.5 - Solving Algorithm Completeness Test
function solving_test() {
    current_test_id = 0;
    mines_visible = false;

    update_ans_button_selection();
    close_reset_test_ui();
    generate_solving_test_ui();
    update_sidebar_buttons();
    start();
}
async function calculate_and_visualize_solutions() {
    /*
    此函数的作用是，使用一个数学上完备的扫雷求解算法来验证此游戏搭载的模块求解算法的完备性，运行此函数可以调用验证算法对
    当前局面求解，然后将此解与模块算法给出的解进行比对，并将比对结果显示在页面上。
     */
    if (game_over) return;
    for (let i = 0; i < X * Y; i++) {
        CELL_ELEMENTS[i].classList.remove('solution-mdl', 'solution-verifier', 'solution-both');
    }

    await calculate_solutions_of_verifier();

    let solutions_consistent= true;
    for (let i = 1; i < bitmap_size; i++) {
        const bits = solutions[i];
        const bits_verifier = solutions_verifier[i];

        if (!bits && !bits_verifier) {
            continue;
        } else if (bits !== bits_verifier) {
            solutions_consistent = false;
        }

        for (let bit_position = 0; bit_position < 32; bit_position++) {
            const index = (i - 1) * 32 + bit_position;
            const cell_element = CELL_ELEMENTS[index];

            const is_solution_in_mdl = bits & (1 << bit_position);
            const is_solution_in_verifier = bits_verifier & (1 << bit_position);

            if (is_solution_in_mdl && is_solution_in_verifier) {
                cell_element.classList.add('solution-both');
            } else if (is_solution_in_mdl) {
                cell_element.classList.add('solution-mdl');
            } else if (is_solution_in_verifier) {
                cell_element.classList.add('solution-verifier');
            }
        }
    }

    if (!solutions_consistent) {
        send_test_result_notice(
            'Solutions of MDL-Algorithm and Verifier are inconsistent. Screenshot captured automatically.<br>'
        );
        await screenshot_data();
    }
}
async function continue_solving_test() {
    if (game_over) return;
    if (!first_click) {
        for (let i = 1; i < bitmap_size; i++) {
            const bits = solutions[i]
            const bits_verifier = solutions_verifier[i];
            if (bits !== bits_verifier) {
                send_notice('progression_blocked');
                return false;
            }
        }
    }

    if (first_click || !solvable) {
        const random_selection = extract_random_safe_cell();
        select_cell(random_selection);
    } else {
        const selections = extract_indices_from_bitmap(solutions);
        const reveal_sequence = calculate_reveal_sequence(selections);
        admin_reveal_cells(reveal_sequence, ID);
    }

    await new Promise(resolve => setTimeout(resolve, 50 + REVEAL_DELAY_LIMIT));
    await calculate_and_visualize_solutions();

    return true;
}
async function complete_full_solving_test() {
    if (game_over) {
        return;
    }
    if (is_testing) {
        is_testing = false;
        return;
    }
    document.getElementById('complete-test-btn').classList.add('selected');
    is_testing = true;
    let solutions_completeness = true;
    while (!game_over && is_testing && solutions_completeness) {
        solutions_completeness = await continue_solving_test();
        if (!game_over && is_testing && solutions_completeness) {
            await new Promise(resolve => setTimeout(resolve, AUTO_SOLVING_TEST_INTERVAL));
        }
    }
    document.getElementById('complete-test-btn').classList.remove('selected');
    is_testing = false;
}
// Todo 1.6 - Reset Algorithm Validation Test
function reset_test() {
    current_test_id = 1;
    mines_visible = false;

    update_ans_button_selection();
    close_solving_test_ui();
    generate_reset_test_ui();
    update_reset_test_selection();
    update_sidebar_buttons();
    start();
}
function select_test(target_test_id) {
    current_test_id = target_test_id;
    start();
    update_reset_test_selection();
    update_ans_button_selection();
}
function select_previous_reset_test() {
    if (current_test_id === 0) return;
    const previous_test_id = current_test_id > 1 ? current_test_id - 1 : TEST_SIZE;
    select_test(previous_test_id);
}
function select_next_reset_test() {
    if (current_test_id === 0) return;
    const next_test_id = current_test_id < TEST_SIZE ? current_test_id + 1 : 1;
    select_test(next_test_id);
}



// < PART 2 - ALGORITHM >

// Todo 2.1 - Bitmap Analyse
function mark_bitmap_as_solution(target_bitmap) {
    const indices = extract_indices_from_bitmap(target_bitmap);
    for (const i of indices) {
        DATA[i] |= Is_;
    }
    for (let i = 0; i < module_collection.length; i++) {
        const module_i = module_collection[i];
        if (module_i) {
            for (let array_position = 1; array_position < bitmap_size; array_position++) {
                module_i[array_position] &= ~target_bitmap[array_position];
            }
            module_collection[i] = module_i;
        }
    }
    add_module_cells_to_solutions(target_bitmap);
}
function mark_bitmap_as_mine(target_bitmap) {
    const indices = extract_indices_from_bitmap(target_bitmap);
    for (const i of indices) {
        DATA[i] |= Im_;
    }
    for (let i = 0; i < module_collection.length; i++) {
        const module_i = module_collection[i];
        if (module_i) {
            const original_cell_count = count_bits(module_i);
            for (let array_position = 1; array_position < bitmap_size; array_position++) {
                module_i[array_position] &= ~target_bitmap[array_position];
            }
            const remaining_cell_count = count_bits(module_i);
            module_i[0] -= original_cell_count - remaining_cell_count;
            module_collection[i] = module_i;
        }
    }
}
function remove_cell_from_solutions(target_cell) {
    const array_position = ((target_cell / 32) | 0);
    const bit_position = target_cell - array_position * 32;
    solutions[array_position + 1] &= ~(1 << bit_position);
}
function extract_indices_from_bitmap(target_bitmap) {
    const indices = [];
    for (let array_position = 1; array_position < bitmap_size; array_position++) {
        let bits = target_bitmap[array_position];
        let bit_position = 0;
        while (bits) {
            if (bits & 1) {
                const index = (array_position - 1) * 32 + bit_position;
                indices.push(index);
            }
            bits >>>= 1;
            bit_position++;
        }
    }
    return indices;
}
function extract_bitwise_intersection(bitmap_a, bitmap_b) {
    const result = new Uint32Array(bitmap_size).fill(0);
    for (let i = 1; i < bitmap_size; i++) {
        result[i] = bitmap_a[i] & bitmap_b[i];
    }
    return result;
}
function extract_bitwise_difference(bitmap_a, bitmap_b) {
    const result = new Uint32Array(bitmap_size).fill(0);
    for (let i = 1; i < bitmap_size; i++) {
        result[i] = bitmap_a[i] & ~bitmap_b[i];
    }
    return result;
}
function count_bits(bitmap) {
    let count = 0;
    const table = BIT_COUNT_8;
    for (let i = 1; i < bitmap_size; i++) {
        const val = bitmap[i];
        count += table[val & 0xFF] +
            table[(val >>> 8) & 0xFF] +
            table[(val >>> 16) & 0xFF] +
            table[val >>> 24];
    }
    return count;
}
// Todo 2.2 - Module Analyse
/*
以下是非常重要的说明：
模块（module）是我自己命名的一个扫雷游戏的概念，不是官方的或公认的，但在我各个版本的游戏中，我都使用了这个名称。
我大致介绍一下它的分析模式：一个模块由两个信息组成，分别是模块中的雷数（n）和模块包含的未打开的坐标（covered_positions），它表示
在所有模块包含的坐标中有且仅有 n 个雷。
假设在一个扫雷局面中有一个可见数字为 1，而它周围有 3 个未打开的坐标，基于此信息可以创建一个模块 A，它的雷数为 1，它的坐标为上述的
三个坐标，这就是模块的初始化（init）。假设存在另一个模块 B 与 A 相交，则两个模块可能生产出新的模块，这就是基于模块结构的信息推理。
继续假设 B 是 2 选 1 的状态，并且 B 的坐标集真包含于 A 的坐标集，则可以推导出新的模块 C，它的雷数为 AB 的差值，它的坐标为 AB 坐标
的差集（A.positions \ B.positions），
在我以往的代码实现中，我通常创建一个类（Class Module），里面存储 int: n 和 array/set: covered_positions，或者我会使用数组的形式
[n, p1, p2, ...] 来表达模块。这导致在分析两个模块之间的关系时操作过多，例如使用大量循环，创建大量临时数组，进而导致算力消耗过大。
在此我使用了新的存储方式：使用一个 Uint32Array 存储一个模块的两个信息。具体地说 Array 的第 0 位用于存储模块的雷数，从第 1 位开始
以位图的结构存储模块中的坐标。
例如在一个棋盘中，存在一个雷数为 n 的模块 A，它的坐标索引为 [0, 1, 4]，则这个模块大致是这样表达的：[n, 0b10011]。
对于 X * Y > 32 的情况，只需用多个 32 位数字分段存储它的位图，因此一个游戏中所有模块的 Uint32Array 的长度（bitmap_size）都在
棋盘规模被确定的时候确定。
这种存储方式最强大的不是它的节约空间，而是在分析的过程中总是使用位运算，并且可以批量处理数据。许多操作的时间复杂度为 O(1)，空间消耗
几乎为 0，例如取两个模块的坐标的交集并集或差集。
为了让模块与此项目中的其它位图无障碍接轨，所有其它位图（例如全局变量 solutions）被设计为从第 1 位开始存储位图信息（不使用第 0 位）。
我认为基于模块这一概念分析扫雷局面是高效稳定和准确的，与另外几种方式比较：相较于计算概率的方法更能处理极端情况，相较于构建线性方程组
求解或构建 CNF 语句求解的方法更能处理矩阵规模过大的情况。
 */
function init_module(center_index) {
    const module = new Uint32Array(bitmap_size).fill(0);
    module[0] = DATA[center_index] & Nr_;
    const x = (center_index / Y) | 0;
    const y = center_index - x * Y;
    for (let n = 0; n < 8; n++) {
        const ix = x + DX[n];
        const iy = y + DY[n];
        if (ix >= 0 && ix < X && iy >= 0 && iy < Y) {
            const i = ix * Y + iy;
            if (!(DATA[i] & Cv_)) {
                continue;
            }
            if (DATA[i] & Is_) {
                continue;
            }
            if (DATA[i] & Im_) {
                module[0]--;
                continue;
            }
            add_cell_to_module(i, module);
        }
    }
    module_collection.push(module);
}
function add_cell_to_module(cell_index, module) {
    const array_position = ((cell_index / 32) | 0);
    const bit_position = cell_index - array_position * 32;
    module[array_position + 1] |= (1 << bit_position);
}
function add_module_cells_to_solutions(target_bitmap) {
    for (let index = 1; index < bitmap_size; index++) {
        solutions[index] |= target_bitmap[index];
    }
}
function process_module_pair(i, j) {
    /*
    此函数会分析两个输入模块的关系，并尝试从当前的两个模块中分析出新的模块，也就是进行信息的推理。
    它的优化之一在于将计算结果存储至原地，第一种运算会产生 1 个新模块，而第二种运算会产生 3 个新模块，但通过对确定的模块进行标记
    以及对部分旧模块进行删除，可以实现输入任意两个模块都只输出至多两个模块，进而实现原地模块运算。
    它的优化之二在于一次遍历直接分析出两个元素的所有关系，然后按照关系耗时和关系出现频率依次处理，比如不相交（disjoint）和
    相等（equals）的情况最常见和简单，可快速排除。巧妙的是排除后就不需要考虑真包含（real subset）和包含（subset）的区别，
    而下一步排除了包含关系就不再需要判断真相交（real intersect）和相交（intersect）的区别（这里我用到的真相交是指两者相交
    但不存在包含关系）。
    由于模块（module）的设计是完美的，分析两个模块以及创建新模块的代码非常简单。
     */
    const module_i = module_collection[i];
    const module_j = module_collection[j];
    module_collection[i] = null;
    module_collection[j] = null;

    let i_empty = true;
    let j_empty = true;
    let i_subset_j = true;
    let j_subset_i = true;
    let equals = true;
    let intersect = false;

    for (let i = 1; i < bitmap_size; i++) {
        const data_i = module_i[i];
        const data_j = module_j[i];

        if (data_i) {
            i_empty = false;
        }
        if (data_j) {
            j_empty = false;
        }
        if (data_i !== data_j) {
            equals = false;
        }
        if (data_i & data_j) {
            intersect = true;
        }
        if (data_i & ~data_j) {
            i_subset_j = false;
        }
        if (data_j & ~data_i) {
            j_subset_i = false;
        }
    }

    if (i_empty || j_empty) {
        if (!i_empty) {
            module_collection[i] = module_i;
        }
        if (!j_empty) {
            module_collection[j] = module_j;
        }
        return false;
    }
    if (equals) {
        module_collection[i] = module_i;
        return false;
    }
    if (!intersect) {
        module_collection[i] = module_i;
        module_collection[j] = module_j;
        return false;
    }

    // Real-Subset
    const i_0 = module_i[0], j_0 = module_j[0];
    if (i_subset_j) {
        const module_k = new Uint32Array(bitmap_size).fill(0);
        module_k[0] = j_0 - i_0;
        for (let i = 1; i < bitmap_size; i++) {
            module_k[i] = module_j[i] & ~module_i[i];
        }
        module_collection[i] = module_i;
        module_collection[j] = module_k;
        return true;
    }
    if (j_subset_i) {
        const module_k = new Uint32Array(bitmap_size).fill(0);
        module_k[0] = i_0 - j_0;
        for (let i = 1; i < bitmap_size; i++) {
            module_k[i] = module_i[i] & ~module_j[i];
        }
        module_collection[j] = module_j;
        module_collection[i] = module_k;
        return true;
    }

    // Real-Intersect
    const intersection = extract_bitwise_intersection(module_i, module_j);
    const diff_ij = extract_bitwise_difference(module_i, module_j);
    const diff_ji = extract_bitwise_difference(module_j, module_i);

    const count_diff_ij = count_bits(diff_ij);
    const count_diff_ji = count_bits(diff_ji);

    if (j_0 - i_0 === count_diff_ji) {
        mark_bitmap_as_solution(diff_ij);
        mark_bitmap_as_mine(diff_ji);

        const module_k = intersection;
        module_k[0] = i_0;
        module_collection[i] = module_k;
        return true;
    }
    if (i_0 - j_0 === count_diff_ij) {
        mark_bitmap_as_solution(diff_ji);
        mark_bitmap_as_mine(diff_ij);

        const module_k = intersection;
        module_k[0] = j_0;
        module_collection[i] = module_k;
        return true;
    }

    module_collection[i] = module_i;
    module_collection[j] = module_j;
    return false;
}
// Todo 2.3 - Module Collection Analyse
function init_module_collection() {
    module_collection = [];
    const inverse_module = new Uint32Array(bitmap_size).fill(0);
    inverse_module[0] = N;
    for (let i = 0; i < X * Y; i++) {
        add_cell_to_module(i, inverse_module);
    }
    module_collection.push(inverse_module);

    total_module_calculation_time = 0;
    total_module_calculation_calls = 0;
}
function calculate_complete_module_collection() {
    const start_time = performance.now()

    let generated_informative_module = true;
    while (generated_informative_module) {
        generated_informative_module = false;
        for (let i = 0; i < module_collection.length; i++) {
            for (let j = i + 1; j < module_collection.length; j++) {
                if (!module_collection[i]) {
                    break;
                }
                if (!module_collection[j]) {
                    continue;
                }
                generated_informative_module |= process_module_pair(i, j);
            }
        }
        generated_informative_module |= filter_decidable_modules();
        filter_null_modules();
    }
    console.log(`Module Collection Size: ${module_collection.length}`);

    const end_time = performance.now();
    const duration = end_time - start_time;
    total_module_calculation_time += duration;
    total_module_calculation_calls++;
}
function filter_null_modules() {
    let write = 0;
    for (let read = 0; read < module_collection.length; read++) {
        if (module_collection[read] !== null) {
            if (read !== write) {
                module_collection[write] = module_collection[read];
            }
            write++;
        }
    }
    module_collection.length = write;
}
function filter_decidable_modules() {
    let module_decided = false;
    for (let i = 0; i < module_collection.length; i++) {
        const module = module_collection[i];
        if (module) {
            if (module[0] === 0) {
                module_collection[i] = null;
                mark_bitmap_as_solution(module);
                module_decided = true;
            } else if (module[0] === count_bits(module)) {
                module_collection[i] = null;
                mark_bitmap_as_mine(module);
                module_decided = true;
            }
        }
    }
    return module_decided;
}
function remove_opened_cells_from_module_collection(list) {
    const module = new Uint32Array(bitmap_size).fill(0);
    for (const i of list) {
        add_cell_to_module(i, module);
    }
    for (let i = 0; i < module_collection.length; i++) {
        const module_i = module_collection[i];
        if (module_i) {
            for (let array_position = 1; array_position < bitmap_size; array_position++) {
                module_i[array_position] &= ~module[array_position];
            }
            module_collection[i] = module_i;
        }
    }
}
// Todo 2.4 - Module-based Solving Algorithm
function check_solvability() {
    solvable = false;
    for (let i = 1; i < solutions.length; i++) {
        if (solutions[i]) {
            solvable = true;
            return;
        }
    }
}
function extract_random_safe_cell() {
    if (first_click) {
        return (Math.random() * X * Y) | 0;
    }
    const selections = [];
    for (let i = 0; i < X * Y; i++) {
        if (!(DATA[i] & Mi_) && (DATA[i] & Cv_)) {
            selections.push(i);
        }
    }
    const ri = (Math.random() * selections.length) | 0;
    return selections[ri];
}
function solve() {
    if (game_over) {
        return;
    }

    if (first_click || !solvable) {
        const random_selection = extract_random_safe_cell();
        select_cell(random_selection);
        return;
    }

    const selections = extract_indices_from_bitmap(solutions);
    const queue = calculate_reveal_sequence(selections);
    admin_reveal_cells(queue, ID);
}
async function solve_all() {
    if (game_over) {
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
        await new Promise(resolve => setTimeout(resolve, AUTO_SOLVE_INTERVAL));
    }
    document.getElementById('solve-all-btn').classList.remove('selected');
    is_solving = false;
}
function send_hint() {
    if (game_over) {
        return;
    }

    let hint_index;
    if (first_click || !solvable) {
        hint_index = extract_random_safe_cell();
    } else {
        const solutions_indices = extract_indices_from_bitmap(solutions);
        const random_index = (Math.random() * solutions_indices.length) | 0;
        hint_index = solutions_indices[random_index];
    }

    const target_element = CELL_ELEMENTS[hint_index];
    target_element.classList.add('hint');
    setTimeout(() => {
        target_element.classList.remove('hint');
    }, 2000);
}
function auto_mark() {
    if (game_over) {
        return;
    }
    for (let i = 0; i < X * Y; i++) {
        if ((DATA[i] & Im_) && (DATA[i] & Cv_)) {
            const target_element = CELL_ELEMENTS[i];
            if (!target_element.classList.contains('marked')) {
                target_element.classList.add('marked');
                counter_marked++;
            }
        }
    }
    update_marks_info();
}
// Todo 2.5 - Module-based Reset Algorithm
function reset_mines(target_mine) {
    /*
    此函数会将输入坐标上的雷转移到其它位置，为确保移动前后所有展示出的数字没有变化，有时实际上必须移动很多关联的雷。
    基于模块算法，这里可以使用一个非常巧妙的方案实现它的主体：将目标雷标记为解，然后将这个假信息加入模块集运算，最后可以得出
    当算法假设此目标为解时，有哪些其它的坐标需要为此改变，以满足模块集的约束。
     */
    let test_result_text = '';

    const text_01 = 'Reset Algorithm Activated.';
    console.warn(text_01);
    test_result_text += text_01 + '<br>';

    if (DATA[target_mine] & Im_) {
        const text_02 = 'Clicked a cell that is definitely a mine'
        test_result_text += text_02 + '<br>';
        console.warn(text_02);

        send_test_result_notice(test_result_text);
        return false;
    }

    const DATA_COPY = new Uint8Array(DATA);

    const fake_module = new Uint32Array(bitmap_size).fill(0);
    add_cell_to_module(target_mine, fake_module);
    module_collection.push(fake_module);
    calculate_complete_module_collection();

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


    for (let index = 0; index < X * Y; index++) {
        if ((DATA[index] & Is_) && (DATA[index] & Mi_)) {
            remove_mine(index);
            const ix = (index / Y) | 0;
            const iy = index - ix * Y
            removed_candidate_list_1 += `[${ix},${iy}] `
            removed_counter_1++;
        }
        if ((DATA[index] & Im_) && !(DATA[index] & Mi_)) {
            set_mine(index);
            const ix = (index / Y) | 0;
            const iy = index - ix * Y
            added_candidate_list_1 += `[${ix},${iy}] `
            added_counter_1++;
        }
    }
    if (removed_counter_1 > 0) {
        const text_11 = `1.Phase removed ${removed_counter_1}: <br>${removed_candidate_list_1}`
        test_result_text += text_11 + '<br>'
        console.warn(text_11);
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
        if ((DATA[i] & Nr_) !== (DATA_COPY[i] & Nr_)) {
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
        let reset_successful = false;
        if (linked_covered_cells.length < RESET_RECURSION_LIMIT) {
            reset_successful = recursive_add_mines(DATA_COPY, linked_number_cells, linked_covered_cells);
            for (const i of linked_covered_cells) {
                if (DATA[i] & Mi_) {
                    const ix = (i / Y) | 0;
                    const iy = i - ix * Y;
                    added_counter_2++;
                    added_candidate_list_2 += `[${ix},${iy}] `
                }
            }
        }
        if (!reset_successful) {
            console.warn('Number Changed!');
        }
        const text_21 = `2.Phase added ${added_counter_2}: <br>${added_candidate_list_2}`
        test_result_text += text_21 + '<br>'
        console.warn(text_21);
    }
    // 2. Phase End


    // 3. Phase - Begin
    const current_number_of_mines = count_current_mines();
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
            DATA.set(DATA_COPY);
            update_all_cells_information_from_data();

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
            DATA.set(DATA_COPY);
            update_all_cells_information_from_data();

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

    const text_end = 'reset complete';
    test_result_text += text_end + '<br>';
    console.warn(text_end);

    update_mines_visibility();
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
// Todo 2.6 - Verifier
async function calculate_solutions_of_verifier() {
    solutions_verifier = new Uint32Array(solutions);
}



// < PART 3 - VISUALIZATION & INTERACTION >

// Todo 3.1 - Board Rending
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
function update_cell_information_from_data(i) {
    const target_element = CELL_ELEMENTS[i];
    const target_cell = DATA[i];
    if (target_cell & Cv_) return;

    if (target_cell & Mi_) {
        target_element.textContent = ' ';
        target_element.classList.add('mine');
    } else {
        const number = (target_cell & Nr_);
        target_element.textContent = number > 0 ? number.toString() : ' ';
        target_element.classList.add('revealed');
    }
}
function update_all_cells_information_from_data() {
    for (let i = 0; i < X * Y; i++) {
        update_cell_information_from_data(i);
    }
}
function update_mines_visibility() {
    if (mines_visible) {
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
function update_cursor() {
    CELL_ELEMENTS[cursor_path].classList.remove('cursor');
    if (cursor_enabled) {
        const target_element = CELL_ELEMENTS[cursor_x * Y + cursor_y];
        target_element.classList.add('cursor');
    }
}
// Todo 3.2 - Animations
function play_reveal_cell_animation(i, current_id) {
    if (current_id !== ID) {
        return;
    }
    const target_element = CELL_ELEMENTS[i];
    target_element.classList.remove('solution-mdl', 'solution-verifier', 'solution-both');
    if (target_element.classList.contains('marked')) {
        target_element.classList.remove('marked');
        counter_marked--;
        update_marks_info();
    }
    update_cell_information_from_data(i);
}
function play_reveal_cells_animation(queue, current_id) {
    let delay = 0;
    let index = 0;
    while (delay < REVEAL_DELAY_LIMIT && index < queue.length) {
        const i = queue[index];
        setTimeout(() => {
            play_reveal_cell_animation(i, current_id);
        }, delay)
        delay += REVEAL_DELAY;
        index++;
    }
    if (index < queue.length) {
        setTimeout(() => {
            while (index < queue.length) {
                play_reveal_cell_animation(queue[index], current_id);
                index++;
            }
        }, delay)
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
// Todo 3.3 - Sidebar & Control Panel
function update_sidebar_buttons() {
    close_difficulty_menu();
    close_background_menu();

    const buttons_visibility = {
        'information-btn': true,
        'start-btn': true,
        'difficulty-btn': current_test_id === null,
        'background-btn': current_test_id === null,
        'mark-btn': current_test_id === null,
        'hint-btn': current_test_id === null,
        'solve-btn': current_test_id === null,
        'solve-all-btn': current_test_id === null,
        'analyse-test-btn': current_test_id === 0,
        'continue-test-btn': current_test_id === 0,
        'complete-test-btn': current_test_id === 0,
        'screenshot-btn': true,
        'guide-btn': current_test_id === null,
        'answer-btn': current_test_id !== null,
        'solving-test-btn': current_test_id > 0,
        'reset-test-btn': current_test_id === 0,
        'exit-btn': current_test_id !== null
    }
    for (const btn_id of Object.keys(buttons_visibility)) {
        document.getElementById(btn_id).style.display = buttons_visibility[btn_id] ? 'block' : 'none';
    }
}
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
function set_difficulty(difficulty) {
    current_difficulty = difficulty;
    start();
    close_difficulty_menu();
}
function set_background(filename = 'default.jpg', title_image = 'dark') {
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
// Todo 3.4 - Information Display & Notifications
function init_information_box() {
    document.getElementById("status-info").textContent = "Ready to start";
    document.getElementById("time-info").textContent = "---";

    document.getElementById('size-info').textContent = `${X} × ${Y} / Mines ${N}`;
    document.getElementById('marks-info').textContent = counter_marked.toString();

    const density = (N / (X * Y) * 100).toFixed(2);
    document.getElementById('density-info').textContent = `${density}%`;
}
function update_time_info() {
    const elapsed = (Date.now() - start_time) / 1000;
    document.getElementById('time-info').textContent = `${elapsed.toFixed(1)} s`;
}
function update_marks_info() {
    document.getElementById('marks-info').textContent = counter_marked;
}
function update_solvability_info() {
    if (game_over) {
        document.getElementById('solvability-info').textContent = '---';
        return;
    }
    check_solvability();
    document.getElementById('solvability-info').textContent = solvable ? 'True' : 'False';
}
function send_notice(type = 'default', locked = true) {
    const now = Date.now();
    if (locked) {
        if (locked && now - last_notice_time < NOTICE_TIME_LIMIT) {
            return;
        }
        last_notice_time = now;
    }

    const { title, content, color } = NOTICE_CONFIG[type];

    const container = document.getElementById('notice-container');
    const notice = document.createElement('div');
    const notice_title = document.createElement('div');
    const notice_content = document.createElement('div');
    const notice_progress = document.createElement('div');

    notice.classList.add('notice');
    notice_title.classList.add('notice-title');
    notice_content.classList.add('notice-content');
    notice_progress.classList.add('notice-progress');

    notice_title.innerHTML = title;
    notice_content.innerHTML = content;
    notice_progress.style.backgroundColor = color;
    notice_progress.style.animation = `progressShrink ${NOTICE_DISPLAY_TIME }ms linear forwards`;

    notice.appendChild(notice_title);
    notice.appendChild(notice_content);
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
    }, NOTICE_DISPLAY_TIME );
}
function send_test_result_notice(text) {
    if (current_test_id === null) {
        return;
    }
    const container = document.getElementById('notice-container');
    const test_result_notice = document.createElement('div');
    const notice_title = document.createElement('div');
    const notice_content = document.createElement('div');

    test_result_notice.classList.add('notice', 'test-result');
    notice_title.classList.add('notice-title');
    notice_content.classList.add('notice-content');

    notice_title.innerHTML = "Test Result";
    notice_content.innerHTML = text + format_time(Date.now());
    test_result_notice.appendChild(notice_title);
    test_result_notice.appendChild(notice_content);

    test_result_notice.onclick = () => {
        if (container.contains(test_result_notice)) {
            container.removeChild(test_result_notice);
        }
    };
    test_result_notice.style.animation = 'slideInRight 0.3s ease forwards';

    container.appendChild(test_result_notice);
}
function log_algorithm_performance() {
    console.log(`Module Algorithm total time: ${total_module_calculation_time.toFixed(1)}ms`);
    console.log(`Function calls: ${total_module_calculation_calls}`);
    console.log(`Average per call: ${(total_module_calculation_time / total_module_calculation_calls).toFixed(1)}ms`);
}
// Todo 3.5 - Test Mode UI
function generate_solving_test_ui() {
    document.getElementById('main-test-container-a').style.display = 'flex';
}
function close_solving_test_ui() {
    document.getElementById('main-test-container-a').style.display = 'none';
}
function generate_reset_test_ui() {
    document.getElementById('main-test-container-b').style.display = 'flex';

    for (let i = 0; i < 5; i++) {
        const test_options_list = document.getElementById(`test-options-${i + 1}`);
        if (test_options_list) {
            test_options_list.innerHTML = '';
        }
    }

    const tests_by_type = {};
    for (let key = 1; key <= TEST_SIZE; key++) {
        const test_type = TEST_CONFIG[key].Type;
        if (!tests_by_type[test_type]) {
            tests_by_type[test_type] = [];
        }
        tests_by_type[test_type].push(key);
    }

    Object.keys(tests_by_type).forEach(type => {
        const test_options_list = document.getElementById(`test-options-${type}`);
        if (test_options_list) {
            tests_by_type[type].forEach(test_id => {
                const test_option = document.createElement('div');
                test_option.classList.add('test-option');
                test_option.innerHTML = `${format_number(test_id)}`;
                test_option.onclick = () => {
                    select_test(test_id);
                };
                test_options_list.appendChild(test_option);
            });
        }
    });

    update_reset_test_selection();
}
function close_reset_test_ui() {
    document.getElementById('main-test-container-b').style.display = 'none';
}
function update_reset_test_selection() {
    document.querySelectorAll('.test-option:not(.ctrl)').forEach(option => {
        const test_id = option.textContent.trim();
        if (test_id === format_number(current_test_id)) {
            option.classList.add('selected');
        } else {
            option.classList.remove('selected');
        }
    });
}
function update_ans_button_selection() {
    const answer_btn = document.getElementById('answer-btn');
    const ans_test_btn_a = document.getElementById('ans-test-btn-a');
    const ans_test_btn_b = document.getElementById('ans-test-btn-b');

    if (mines_visible) {
        answer_btn.classList.add('selected');
        ans_test_btn_a.classList.add('selected');
        ans_test_btn_b.classList.add('selected');
    } else {
        answer_btn.classList.remove('selected');
        ans_test_btn_a.classList.remove('selected');
        ans_test_btn_b.classList.remove('selected');
    }
}
// Todo 3.6 - Utilities & Tools
function start_timer() {
    start_time = Date.now();
    timer_interval = setInterval(update_time_info, 100);
    update_time_info();
}
function handle_keydown(event) {
    /*
    此函数是确定所有快捷键的唯一函数。
    我设计的光标（cursor）可以实现玩家用键盘操作游戏，具体相关操作请查看函数内容。
     */
    const key = event.key.toLowerCase();
    const shift_enabled = event.shiftKey;

    if (current_test_id !== null) {
        switch (key) {
            case 'r':
                start();
                return;
            case 'escape':
                exit_test();
                return;
            case ' ':
                toggle_mines_visibility();
                break;
            case 'arrowright':
            case 'arrowdown':
                select_next_reset_test();
                break;
            case 'arrowleft':
            case 'arrowup':
                select_previous_reset_test();
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
function copy_text_to_clipboard(text) {
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
async function screenshot_data(candidate = true) {
    /*
    此函数的作用是对当前扫雷局面进行截图，并用当前时间命名图片并下载图片到默认文件夹。
    由于浏览器禁止截图操作，我的实现方法是根据当前局面的信息绘制图片，在绘制的时候可通过输入布尔值选择是否绘制坐标轴。
    在绘制过程中各 RGB 颜色是由此项目中 RGBA_Color.java 计算的，因此绘制的图片与页面几乎无差别，但如果修改 css 文件中的棋盘设计，
    需要同步修改此函数中对应的设计。
     */
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
            } else if (cell_element.classList.contains('solution-both')) {
                ctx.fillStyle = 'rgba(255, 220, 120, 1)';
                ctx.strokeStyle = 'rgba(255, 231, 161, 1)';
            } else if (cell_element.classList.contains('solution-mdl')) {
                ctx.fillStyle = 'rgba(240, 160, 80, 1)';
                ctx.strokeStyle = 'rgba(245, 189, 133, 1)';
            }  else if (cell_element.classList.contains('solution-verifier')) {
                ctx.fillStyle = 'rgba(234, 88, 12, 1)';
                ctx.strokeStyle = 'rgba(240, 138, 85, 1)';
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



// < PART 4 - APPLICATION INITIALIZATION >

// Todo 4.1 - Application Startup Sequence
document.addEventListener('keydown', handle_keydown);
preload_backgrounds();
update_sidebar_buttons();
start();