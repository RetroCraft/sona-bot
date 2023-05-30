import cron from 'node-cron';
import chalk from 'chalk';
import { EmbedBuilder, WebhookClient } from 'discord.js';
import { until } from 'selenium-webdriver';
import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import fs from 'fs';
import { webhookId, webhookToken, sonaUsername, sonaPassword } from './config.json';

const screen = {
  width: 640,
  height: 480
};

interface Study {
  id: string;
  name: string;
  link: string;
  credits: string;
  description: string;
}

const webhookClient = new WebhookClient({ id: webhookId, token: webhookToken });
const driver = new Builder().forBrowser('chrome')
  .setChromeOptions(new chrome.Options().headless().windowSize(screen)).build();

const log = (message: any, fn = console.log) => fn(chalk.dim(`[${new Date().toISOString()}]`), message)

const readCache = async (): Promise<Study[]> => {
  try {
    const cache = fs.readFileSync('./cache.json', 'utf8');
    return JSON.parse(cache);
  } catch (error) {
    return [];
  }
}

const writeCache = async (studies: Study[]) => {
  fs.writeFileSync('./cache.json', JSON.stringify(studies, null, 2), 'utf8');
}

const fetchStudies = async (): Promise<Study[]> => {
  await driver.manage().deleteAllCookies();
  await driver.get('https://wlu-ls.sona-systems.com/default.aspx?logout=Y');
  log('logging in...')
  driver.findElement({ id: 'ctl00_ContentPlaceHolder1_userid' }).sendKeys(sonaUsername);
  driver.findElement({ id: 'pw' }).sendKeys(sonaPassword);
  driver.findElement({ id: 'ctl00_ContentPlaceHolder1_default_auth_button' }).click();
  await driver.wait(until.urlIs(`https://wlu-ls.sona-systems.com/Main.aspx?p_log=${sonaUsername}`), 10000);
  await driver.get('https://wlu-ls.sona-systems.com/all_exp_participant.aspx');
  log('fetching studies...')
  const table = driver.wait(until.elementLocated({ css: 'div.form-horizontal.tasi-form table' }));
  const rows = await table.findElements({ css: 'tbody tr' });
  const studies = await Promise.all(rows.map(async (row) => {
    const rowId = await row.getAttribute('id');
    log(`parsing row ${rowId}...`)
    log(await row.getText())
    // example: ctl00_ContentPlaceHolder1_repStudentStudies_ctl07_RepeaterRow
    const idBase = rowId.split('_RepeaterRow')[0]
    const name = await row.findElement({ id: `${idBase}_HyperlinkStudentStudyInfo` }).getText();
    const link = await row.findElement({ id: `${idBase}_HyperlinkStudentTimeSlot` }).getAttribute('href');
    const id = link.split('experiment_id=')[1];
    const credits = await row.findElement({ id: `${idBase}_LabelCredits` }).getText();
    const description = await row.findElement({ id: `${idBase}_LabelStudyType` }).getText();
    return { id, name, link: `link`, credits, description };
  }));
  return studies;
}

const diffStudies = async (oldStudies: Study[], newStudies: Study[]) => {
  const oldIds = oldStudies.map((study) => study.id);
  const newIds = newStudies.map((study) => study.id);
  const addedIds = newIds.filter((id) => !oldIds.includes(id));
  return newStudies.filter((study) => addedIds.includes(study.id));
}

const loop = async () => {
  try {
    const oldStudies = await readCache();
    const newStudies = await fetchStudies();
    const addedStudies = await diffStudies(oldStudies, newStudies);
    await writeCache(newStudies);

    if (addedStudies.length > 0) {
      const embeds = addedStudies.slice(0, 10).map((study) =>
        new EmbedBuilder()
          .setTitle(study.name)
          .setURL(study.link)
          .addFields([
            { name: 'Credits', value: study.credits },
            { name: 'Description', value: study.description },
          ])
          .setColor(0x00FFFF));
      webhookClient.send({
        content: `There are ${addedStudies.length} new studies:`,
        username: 'SONA!!!',
        embeds,
      });
    }
  } catch (error) {
    log(error, console.error);
  }
}

// run every 15 minutes from 8am to midnight
cron.schedule('*/15 8-23 * * *', loop);
loop();
