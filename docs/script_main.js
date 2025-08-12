// script_main.js - 02.08.2025

// < Part 0 - Define Global-Variables >

/*
X 为矩阵的行数，Y 为列数，N 为雷的数量，DATA 为存储矩阵信息的高密度容器 Uint8Array
具体存储方式为，将存储 Cell 的二维矩阵扁平化为一维数组，将单个 Cell 的各项信息分别存储在 8 位中的各个部分，具体存储方式在下面表格中
而 CELL_ELEMENTS 只用于存储 cell_element 的索引，它无法被 Uint8Array 压缩，只能用普通数组存储
它的作用是快速寻找到需要渲染的 cell，而不必频繁调用 querySelector
*/
let X, Y, N, BOARD_DATA, CELL_ELEMENTS;

/*
数据通过下面的 Mask 被压缩，通过位运算可直接获取它们的各项信息，由于 number 这一项信息的数据类型为 int，我选择把它放到最低位，
这样只需掩码位运算就可获取到 int 以及更改它的值，如果放在高位，需要额外的左移和右移运算，并且在游戏中它的值为 0-8，因此只需要 4 bit
的位置即可存储它的值
而其它元素均为 boolean，可以随意放置，其中 internal-mark 是内部标记，用于内部算法计算，与 mark 外部标记不同，外部标记由玩家操控，
用于辅助玩家完成游戏，也正是因此外部标记不需要存储到 DATA 中，而是直接存在页面中对应的 cell-div-classList 中
-----------------------------------------
| internal-mark   | visited   | covered   | mine   | number (0-8)   |
| bit 7           | bit 6     | bit 5     | bit 4  | bit 0-3        |
-----------------------------------------
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

let current_difficulty = 'high';
let id = 0;

const STORED_HASH = '6db07d30';
const DX = [-1, 0, 1, 0, -1, 1, 1, -1];
const DY = [0, 1, 0, -1, 1, 1, -1, -1];

const CELL_SIZE = 24;
const FONT_SIZE = 16;
const ALGORITHM_LIMIT = 480;

let first_step = true;
let game_over = false;

let start_time = null;
let timer_interval = null;
let last_notice_time = 0;

let algorithm_enabled = false;
let cursor_enabled = false;

let counter_revealed, counter_marked;
let cursor_x, cursor_y, cursor_path;



// < Part 1 - Game Logic >

// Todo 1.1 - Init
function start({parameters} = {}) {
    id++;

    const params = get_difficulty_params(current_difficulty);
    X = params.X;
    Y = params.Y;
    N = params.N;
    BOARD_DATA = new Uint8Array(X * Y);

    init_board_data();
    generate_game_field();
    render_border();

    algorithm_enabled = X * Y <= ALGORITHM_LIMIT;
    algorithm_enabled = false;
    first_step = true;
    game_over = false;
    counter_revealed = 0;
    counter_marked = 0;
    cursor_x = 4;
    cursor_y = 4;
    cursor_path = cursor_x * Y + cursor_y;

    start_time = null;
    clearInterval(timer_interval);

    init_information_box();
    update_solvability_info();
    updateCursor();
}
function init_board_data() {
    for (let i = 0; i < X * Y; i++) {
        BOARD_DATA[i] |= Cv_;
    }
    add_mines_random(N);
}
function add_mines_random(target_number_of_mines) {
    let counter = 0;
    while (counter < target_number_of_mines) {
        const ri = (Math.random() * X * Y) | 0;

        if (BOARD_DATA[ri] & Mi_) continue;
        BOARD_DATA[ri] |= Mi_;

        const rx = (ri / Y) | 0;
        const ry = ri - rx * Y;

        for (let n = 0; n < 8; n++) {
            const x = rx + DX[n];
            const y = ry + DY[n];
            if (x >= 0 && x < X && y >= 0 && y < Y) {
                BOARD_DATA[x * Y + y]++;
            }
        }
        counter++;
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
            return { X: x, Y: y, N: 0 };
        default:
            return { X: 16, Y: 30, N: 99 };
    }
}
function activate_algorithm(password) {
    if (hash_x(password) !== STORED_HASH) return;
    algorithm_enabled = true;
    console.log("Algorithm activated.");
}
function deactivate_algorithm() {
    algorithm_enabled = false;
    console.log("Algorithm deactivated.");
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
    if (game_over || !(BOARD_DATA[i] & Cv_)) {
        return;
    }
    if (first_step) {
        while (BOARD_DATA[i] & Mi_) {
            console.log("Restart - first step");
            start();
        }
        document.getElementById('status-info').textContent = 'In Progress';
        first_step = false;
        start_timer();
    }
    const target_element = CELL_ELEMENTS[i];
    if (target_element.classList.contains('marked')) {
        target_element.classList.remove('marked');
        counter_marked--;
        update_marks_info();
        return;
    }

    admin_reveal_cell(i, id);
    if (!(BOARD_DATA[i] & Nr_)) {
        reveal_linked_cells_with_delay(i, id);
    }
}
function reveal_linked_cells_with_delay(i, current_id) {
    const queue = [i];
    BOARD_DATA[i] |= Vs_;

    let index = 0;
    while (index < queue.length) {
        const j = queue[index];
        index++;
        if (BOARD_DATA[j] & Nr_) {
            continue;
        }
        const jx = (j / Y) | 0;
        const jy = j - jx * Y;
        for (let n = 0; n < 8; n++) {
            const x = jx + DX[n];
            const y = jy + DY[n];
            if (x >= 0 && x < X && y >= 0 && y < Y) {
                const k = x * Y + y;
                if (!(BOARD_DATA[k] & Vs_)) {
                    queue.push(k);
                    BOARD_DATA[k] |= Vs_;
                }
            }
        }
    }
    let delay = 0;
    const step = 5;
    for (const j of queue) {
        setTimeout(() => {
            admin_reveal_cell(j, current_id);
        }, delay)
        delay += step;
    }
}

function admin_reveal_cell(i, current_id) {
    /*
    注意！所有 reveal cell 的行为必须通过此函数
    因为所有检测游戏状态的机制和终止游戏的行为都从此函数开始，此处为分界线
     */
    if (game_over || current_id !== id) {
        return;
    }
    if (!(BOARD_DATA[i] & Cv_)) {
        return;
    }
    const target_element = CELL_ELEMENTS[i];
    if (target_element.classList.contains('marked')) {
        target_element.classList.remove('marked');
        counter_marked--;
        update_marks_info();
    }
    BOARD_DATA[i] &= ~Cv_;
    update_cell_display(i);
    counter_revealed++;
    if (!game_over & counter_revealed === X * Y - N) {
        terminate(true);
    }
}
function mark_cell(i) {
    if (game_over || !(BOARD_DATA[i] & Cv_)) {
        return;
    }
    const target_cell = CELL_ELEMENTS[i];
    if (target_cell.classList.contains('marked')) {
        target_cell.classList.remove('marked');
        counter_marked--;
    } else {
        target_cell.classList.add('marked');
        counter_marked++;
    }
    update_marks_info();
}
// Todo 1.3 - Algorithm for UI
function auto_mark() {
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('n_enabled');
        return;
    }
}
function send_hint() {
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('n_enabled');
        return;
    }
    let hx = 0;
    let hy = 0;
    const target_element = CELL_ELEMENTS[hx * Y + hy];
    target_element.classList.add('hint');
    setTimeout(() => {
        target_element.classList.remove('hint');
    }, 2000);
}
function solve() {
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('n_enabled');
        return;
    }
}
async function solve_all() {
    if (game_over) {
        return;
    }
    if (!algorithm_enabled) {
        send_notice('n_enabled');
        return;
    }
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
    const target_cell = BOARD_DATA[i];
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

}
// Todo 2.4 - Message / Shortcuts
function send_notice(type, timeout = 4500) {
    const now = Date.now();
    if (now - last_notice_time < 600) { return; }
    last_notice_time = now;

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
        default:
            notice_text.innerHTML = "Notice.<br> Default Notice Content - 1024 0010 0024.";
            notice_progress.style.backgroundColor = 'rgba(0, 150, 255, 1)';
            break;
    }
    notice_progress.style.animation = `progressShrink ${timeout}ms linear forwards`;
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
    }, timeout);
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



// < Part 3 - Init / Load >

// Todo 3.1 - Init Game / Load Monitor
document.addEventListener('keydown', handle_keydown);
start();