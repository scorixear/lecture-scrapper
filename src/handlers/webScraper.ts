import { Lecture, Lecturer, Module } from '@prisma/client';
import puppeteer from 'puppeteer';
import { Browser } from 'puppeteer';
import { StringToLectureType } from '../buttons/calendarButton';
import LanguageHandler from './languageHandler';

export class WebScraper {
  private browser?: Browser;
  public async init() {
    this.browser = await puppeteer.launch();
  }

  public async testInput(url: string, selector: string): Promise<any | undefined> {
    if (!this.browser) return undefined;
    console.log('Awaiting new Page');
    const page = await this.browser?.newPage();
    console.log('Navigating to url', page);
    await page?.goto(url);
    console.log('Selecting elements');
    const modules = await page?.$eval(selector, (elem) => elem.textContent);
    return modules;
  }

  public async scrapeLectures(
    url: string,
    semester: string
  ): Promise<(Module & { lecturers: Lecturer[]; lectures: Lecture[] })[] | undefined> {
    if (!this.browser) return undefined;
    const page = await this.browser?.newPage();
    await page?.goto(LanguageHandler.replaceArgs(url, [semester]));
    // Selecting all base units

    const moduleElements = await page?.$$('.n-studgang-unit .n-unit');
    const modulePromises: Promise<any>[] = [];
    moduleElements.forEach((module) => {
      modulePromises.push(module.$eval('.n-unit-head .n-unit-title .title', (element) => element.textContent)); // displayName
      modulePromises.push(module.$('.s-termin-entry')); // id
      modulePromises.push(module.$eval('.n-unit-head .n-unit-title .n-unit-dozent', (element) => element.textContent)); // professor (potential undefined)
      modulePromises.push(module.$$('.s-termin-entry')); // lectures
    });

    const moduleInfos = await Promise.all(modulePromises);
    const modules: (Module & { lectures: Lecture[]; lecturers: Lecturer[] })[] = [];
    const date = new Date();
    for (let i = 0; i < moduleInfos.length; i += 4) {
      const displayName = moduleInfos[i] as string | null;
      const idEntry = moduleInfos[i + 1] as puppeteer.ElementHandle<Element> | null;
      const professor = moduleInfos[i + 2] as string | null;
      const lecturesElements = moduleInfos[i + 3] as puppeteer.ElementHandle<Element>[];

      if (!displayName || displayName.trim() === '') continue;
      let id: string | undefined = '';
      const idElements = await idEntry?.$$('.s_termin_modul .termin_modul');
      const ids = await Promise.all(
        idElements?.map(async (element) => {
          return await element.evaluate((el) => el.textContent);
        }) ?? []
      );
      if (ids && ids.length > 1) {
        id = ids.at(-1) ?? undefined;
      } else if (ids) {
        id = ids[0] ?? undefined;
      } else {
        continue;
      }
      if (!id || id.trim() === '') continue;
      const module = {
        id: 0,
        uni_id: id,
        name: displayName,
        semester,
        date: date.getTime() as unknown as bigint,
        professor: professor,
        lecturers: new Array<Lecturer>(),
        lectures: new Array<Lecture>()
      };
      const lecturePromises: Promise<any>[] = [];
      lecturesElements.forEach((lecture) => {
        lecturePromises.push(lecture.$eval('.s_termin_typ', (element) => element.textContent)); // Type
        lecturePromises.push(lecture.$eval('.s_termin_von', (element) => element.textContent)); // from
        lecturePromises.push(lecture.$eval('.s_termin_bis', (element) => element.textContent)); // to
        lecturePromises.push(lecture.$eval('.s_termin_zeit', (element) => element.textContent)); // day
        lecturePromises.push(lecture.$eval('.s_termin_raum', (element) => element.textContent)); // place
        lecturePromises.push(
          lecture.$$eval('.s_termin_dozent a', (elements) => elements.map((element) => element.textContent))
        ); // lecturers
      });
      const lectureValues = await Promise.all(lecturePromises);
      const lectures: Lecture[] = [];
      const lecturers: Set<string> = new Set();
      for (let j = 0; j <= lectureValues.length; j += 6) {
        const typeString = (lectureValues[j] as string | null)?.split(',')[0];
        const type = StringToLectureType.get(typeString ?? '');
        if (!type) continue;
        const group = (lectureValues[j] as string | null)?.split(',').at(1) ?? null;
        let time: string | null = null;
        if ((lectureValues[j + 1] as string | null) !== null) {
          time = (lectureValues[j + 1] as string | null) + '-' + (lectureValues[j + 2] as string | null);
        }
        const day = lectureValues[j + 3] as string | null;
        if (!day) continue;
        const place = lectureValues[j + 4] as string | null;
        if (!place) continue;
        const unfilteredLecturers = lectureValues[j + 5] as (string | null)[];
        const filteredLecturers = unfilteredLecturers.filter((lecturer) => lecturer !== null) as string[];
        if (filteredLecturers.length === 0) continue;
        const lecture = {
          id: 0,
          module_id: 0,
          type,
          day,
          place,
          time,
          group
        };
        lectures.push(lecture);
        filteredLecturers.forEach((l) => lecturers.add(l));
      }
      const [first] = lecturers;
      if (module.professor === null || module.professor.trim() === '') {
        module.professor = first;
      }
      module.lectures = lectures;
      module.lecturers = [...lecturers].map((l) => ({ name: l, module_id: 0 }));
      modules.push(module);
    }
    return modules;
  }
}
