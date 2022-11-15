// @ts-check
import { BackgroundHandler } from '@netlify/functions'
import { Octokit } from '@octokit/rest'
import fs from 'fs'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { kebabCase } from 'lodash-es'
import { tmpdir } from 'os'
import path from 'path'
import { inspect } from 'util'
import { literal, number, object, string, union } from 'zod'

const now = Date.now()

const repoUrl = 'https://github.com/withastro/astro.build.git'
const repoFolder = path.join(tmpdir(), `astro.build-${now}`)

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
})

const formImageSchema = object({
    filename: string(),
    type: string(),
    size: number(),
    url: string()
})

const themeDataSchema = object({
    mainPreviewImage: formImageSchema,
    previewImage1: union([formImageSchema, literal('')]),
    previewImage2: union([formImageSchema, literal('')]),
    previewImage3: union([formImageSchema, literal('')]),
    previewImage4: union([formImageSchema, literal('')]),
    authorName: string(),
    authorEmail: string(),
    themeName: string(),
    paidStatus: string(),
    repoUrl: string(),
    purchaseUrl: string(),
    liveDemoUrl: string(),
    shortDescription: string()
}).partial()

export const handler: BackgroundHandler = async (event) => {
    try {
        const body = event.isBase64Encoded
            ? JSON.parse(Buffer.from(event.body, 'base64').toString())
            : JSON.parse(event.body)

        const themeData = themeDataSchema.parse(body?.data)

        console.info(
            'Theme data:',
            inspect(themeData, { depth: Infinity, colors: true })
        )

        const branchName = `theme-submissions/${kebabCase(
            themeData.themeName
        )}-${now}`
        console.info('Branch name:', branchName)

        const themeFileName = `${kebabCase(themeData.themeName)}-${now}.json`
        console.info('Theme file name:', themeFileName)

        console.info('mkdir', path.dirname(repoFolder))
        await fs.promises.mkdir(path.dirname(repoFolder), { recursive: true })

        console.info('git.clone', repoUrl, repoFolder)
        await git.clone({
            fs,
            http,
            url: repoUrl,
            dir: repoFolder,
            singleBranch: true,
            depth: 1
        })

        console.info('git.checkout', branchName)
        await git.checkout({
            fs,
            dir: repoFolder,
            ref: branchName
        })

        console.info(
            'write',
            path.join(repoFolder, 'src/data/themes', themeFileName)
        )
        await fs.promises.writeFile(
            path.join(repoFolder, 'src/data/themes', themeFileName),
            JSON.stringify(themeData, undefined, 2)
        )

        console.info('git.add .')
        await git.add({
            fs,
            dir: repoFolder,
            filepath: '.'
        })

        console.info('git.commit')
        await git.commit({
            fs,
            dir: repoFolder,
            message: `Add theme ${themeData.themeName}`
        })

        console.info('git.push')
        await git.push({
            fs,
            http,
            dir: repoFolder,
            remote: 'origin',
            ref: branchName
        })

        console.info('create PR')
        await octokit.pulls.create({
            owner: 'withastro',
            repo: 'astro.build',
            title: `THEME: ${themeData.themeName ?? ''}`,
            body: [
                `**Author**: ${themeData.authorName ?? 'N/A'}`,
                `**Paid or Free**: ${themeData.paidStatus ?? 'N/A'}`,
                `**Repo Link**: ${themeData.repoUrl ?? 'N/A'}`,
                `**Purchase Link**: ${themeData.purchaseUrl ?? 'N/A'}`,
                `**Live Demo Link**: ${themeData.liveDemoUrl ?? 'N/A'}`,
                `**Preview Image**: ${
                    themeData.mainPreviewImage?.url ?? 'N/A'
                }`,
                ``,
                themeData.shortDescription ?? ''
            ].join('\n'),
            head: branchName,
            base: 'main'
        })

        console.info('done!')
    } finally {
        await fs.promises.rm(repoFolder, { recursive: true, force: true })
    }
}
