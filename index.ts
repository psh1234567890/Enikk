import { Client, GatewayIntentBits, ActivityType, EmbedBuilder } from 'discord.js';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

function convertTier(level: number): string {
    if (level <= 0) return "Unrated";
    const colors = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ruby", "Master"];
    const colorIdx = Math.floor((level - 1) / 5);
    const rank = 5 - ((level - 1) % 5);
    if (colorIdx > 5) return "Master";
    return `${colors[colorIdx]} ${rank}`;
}

// 👇 솔브닥 전용 통신 함수를 아예 따로 만들었습니다! (위장 + JSON 변환 완벽 처리)
// 👇 완벽하게 브라우저로 위장한 솔브닥 전용 통신 함수
// 👇 axios를 사용하도록 완전히 개조된 통신 함수!
// 👇 사람인 척 위장하지 않고, 당당하게 봇임을 밝히는 통신 함수!
async function fetchSolvedAc(url: string) {
    const res = await axios.get(url, {
        headers: {
            // 1. 당당한 신분증: "나는 사람(크롬)이 아니라 에닉 봇이다!"
            'User-Agent': 'EnikkBot/1.0 (Discord Bot for O(1) Club)',
            
            // 2. 데이터 형식: JSON만 줘!
            'Accept': 'application/json',
            
            // 3. 에러 로그 방지: 복잡한 압축(br) 말고 일반 압축(gzip)으로 줘!
            'Accept-Encoding': 'gzip, deflate',
            
            // 4. 언어 설정
            'x-solvedac-language': 'ko'
        }
    });
    return res.data;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    const command = args.shift();

    if (command === '!안녕') {
        message.reply('안녕하십니까. 저는 디스코드 서버 관리 A.I. 에닉입니다.');
    }

    if(command == '!사용방법' || command == '!사용법'){
        message.reply('[사용방법]\n1. !조회 xxxxx: 해당 학번의 학생 정보를 출력합니다.\n2. !문제추천 xxxxx or !추천 xxxxx: 해당 학번의 학생의 티어 정보를 분석해 문제를 추천해드립니다. 풀지 않은 문제들로만 구성합니다.\n3. !전체목록 or !전체출력: 등록된 학생 명단을 전부 출력합니다.\n4. !랭킹 or !명예의 전당: 랭킹별로 학생들 등수를 출력합니다. 자신의 위치를 파악해보십시오.')
    }

    // 🎯 1. 시민 조회 기능
    if (command === '!조회') {
        if (args.length === 0) return message.reply('⚠️ 오류: 조회할 학번을 입력하십시오.');

        const studentId = args[0].replace(/[^0-9]/g, '');
        if (!studentId) return message.reply('⚠️ 오류: 학번은 숫자로 입력해 주십시오.');

        const { data, error } = await supabase.from('students').select('*').eq('student_id', parseInt(studentId)).single();

        if (error || !data) return message.reply(`❌ 해당 학번(${studentId})의 학생을 찾을 수 없습니다.`);

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`[학생 정보] ${data.name}`)
            .addFields(
                { name: '학번', value: `${data.student_id}`, inline: true },
                { name: '나이/성별', value: `${data.age}세 / ${data.gender}`, inline: true },
                { name: '백준 ID', value: data.baekjoon_id, inline: true },
                { name: '현재 티어', value: `**${data.solved_ac_tier}**`, inline: true }
            )
            .setURL(`https://solved.ac/profile/${data.baekjoon_id}`)
            .setTimestamp();

        message.reply({ embeds: [embed] });
    }

    // 🎯 2. 맞춤 작전(문제) 추천 기능
    if (command === '!문제추천' || command === '!추천') {
        if (args.length === 0) return message.reply('⚠️ 오류: 문제를 추천할 학생의 학번을 입력하십시오.');

        const studentId = args[0].replace(/[^0-9]/g, '');
        if (!studentId) return message.reply('⚠️ 오류: 학번은 숫자로 입력해 주십시오.');

        const { data, error } = await supabase.from('students').select('*').eq('student_id', parseInt(studentId)).single();
        if (error || !data) return message.reply(`❌ 해당 학번(${studentId})의 학생을 찾을 수 없습니다.`);

        const handle = data.baekjoon_id;
        const loadingMsg = await message.reply(`🔍 **${data.name}** 학생의 해결 데이터를 분석 중입니다...`);

        try {
            // 🚨 핵심 수정: 특수문자와 띄어쓰기를 URL용(%20, %3A)으로 번역합니다!
            const searchQuery1 = encodeURIComponent(`solved_by:${handle}`);
            const url = `https://solved.ac/api/v3/search/problem?query=${searchQuery1}&sort=level&direction=desc`;
            const json = await fetchSolvedAc(url);

            if (json.count === 0) {
                return loadingMsg.edit('⚠️ 해당 학생은 아직 해결한 문제가 없습니다.');
            }

            const targetRank = Math.min(json.count - 1, 10);
            const page = Math.floor(targetRank / 20) + 1;
            let itemIdx = targetRank % 20;

            const pagedJson = await fetchSolvedAc(`${url}&page=${page}`);

            if (pagedJson.items.length <= itemIdx) {
                itemIdx = pagedJson.items.length - 1;
            }

            let medianLevel = pagedJson.items[itemIdx].level;

            // 🚨 여기도 띄어쓰기(' -')가 있으므로 반드시 통째로 번역해야 합니다!
            const searchQuery2 = encodeURIComponent(`tier:${medianLevel} -solved_by:${handle}`);
            let recUrl = `https://solved.ac/api/v3/search/problem?query=${searchQuery2}`;
            let recJson = await fetchSolvedAc(recUrl);
            let items = recJson.items;

            // 풀지 않은 문제가 없으면 티어 + 1 올려서 재검색
            if (items.length === 0) {
                medianLevel++;
                const searchQuery3 = encodeURIComponent(`tier:${medianLevel} -solved_by:${handle}`);
                recUrl = `https://solved.ac/api/v3/search/problem?query=${searchQuery3}`;
                recJson = await fetchSolvedAc(recUrl);
                items = recJson.items;
            }

            // 문제 섞기 (C++의 shuffle 역할)
            items.sort(() => Math.random() - 0.5);
            const picked = items.slice(0, 5); // 5개만 뽑기

            // 디스코드 카드로 결과 출력
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle(`🎯 [시뮬레이션 룸] ${data.name} 맞춤 문제`)
                .setDescription(`분석된 주력 풀이 구간: **${convertTier(medianLevel)}**\n다음 문제를 해결하여 랭킹을 올리십시오.`)
                .setTimestamp();

            picked.forEach((prob: any) => {
                embed.addFields({
                    name: `[${prob.problemId}] ${prob.titleKo}`,
                    value: `티어: ${convertTier(prob.level)} | [사이트 이동](https://www.acmicpc.net/problem/${prob.problemId})`,
                    inline: false
                });
            });

            await loadingMsg.edit({ content: '✅ 분석 완료.', embeds: [embed] });

        } catch (err) {
            console.error('❌ 문제 추천 중 에러 발생:', err); 
            loadingMsg.edit('❌ 문제 데이터를 가져오는 중 통신 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
        }
    }

    // 🎯 3. 전체 시민 목록 출력
    if (command === '!전체목록' || command === '!전체출력') {
        const { data, error } = await supabase.from('students').select('*').order('student_id', { ascending: true });
        if (error || !data) return message.reply('❌ 데이터를 불러올 수 없습니다.');

        let listText = '```md\n# [학생 전체 명단]\n';
        data.forEach(s => listText += `${s.student_id}. ${s.name} (${s.gender}) - ${s.solved_ac_tier}\n`);
        listText += '```';
        message.reply(listText);
    }

    // 🎯 4. 명예의 전당 (티어 랭킹)
    if (command === '!랭킹' || command === '!명예의전당') {
        const { data, error } = await supabase.from('students').select('*');
        if (error || !data) return message.reply('❌ 데이터를 분석할 수 없습니다.');

        const getScore = (tier: string) => {
            if (tier === '솔브닥 미연동' || tier === 'Unknown') return -1; 
            if (tier === 'Unrated') return 0;
            if (tier === 'Master') return 31;

            const colors: { [key: string]: number } = { "Bronze": 0, "Silver": 5, "Gold": 10, "Platinum": 15, "Diamond": 20, "Ruby": 25 };
            const parts = tier.split(' ');
            return (colors[parts[0]] ?? 0) + (6 - parseInt(parts[1]));
        };

        const sorted = data.sort((a, b) => getScore(b.solved_ac_tier) - getScore(a.solved_ac_tier));

        const embed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setTitle('🏆 [O(1) 명예의 전당 - 백준 랭킹 순위]')
            .setDescription('동아리 내 최고의 알고리즘 실력을 가진 학생들입니다.')
            .setTimestamp();

        let rankingText = '';
        sorted.forEach((s, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
            rankingText += `${medal} **${index + 1}위**: ${s.name} (${s.solved_ac_tier})\n`;
        });

        embed.addFields({ name: '실시간 순위 리스트', value: rankingText || '데이터 없음' });
        message.reply({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);