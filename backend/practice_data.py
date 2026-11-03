"""
Practice questions repository for CodeLoop Practice Zone.
Includes beginner, intermediate, and advanced problems across topics and languages.
Each problem contains multi-tier hints: Hint 1 -> Hint 2 -> Approach -> Solution.
"""

PRACTICE_PROBLEMS = [
    {
        "id": "py-01",
        "title": "Sum of Two Numbers",
        "topic": "Variables & I/O",
        "difficulty": "Beginner",
        "points": 10,
        "description": "Write a program that reads two space-separated integers from STDIN and prints their sum.",
        "input_format": "A single line containing two integers separated by a space (for example: '5 7').",
        "output_format": "Print the integer sum on a single line.",
        "starter_codes": {
            "python": "# Read inputs and compute sum\nimport sys\nline = sys.stdin.read().strip()\nif line:\n    a, b = map(int, line.split())\n    # Your code here\n",
            "javascript": "const fs = require('fs');\nconst input = fs.readFileSync(0, 'utf-8').trim();\nif (input) {\n  const [a, b] = input.split(/\\s+/).map(Number);\n  // Your code here\n}\n",
            "c": "#include <stdio.h>\n\nint main() {\n    int a, b;\n    if (scanf(\"%d %d\", &a, &b) == 2) {\n        // Your code here\n    }\n    return 0;\n}\n",
            "cpp": "#include <iostream>\nusing namespace std;\n\nint main() {\n    int a, b;\n    if (cin >> a >> b) {\n        // Your code here\n    }\n    return 0;\n}\n",
            "java": "import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        if (sc.hasNextInt()) {\n            int a = sc.nextInt();\n            int b = sc.nextInt();\n            // Your code here\n        }\n    }\n}\n"
        },
        "sample_cases": [
            {"input": "5 7", "expected_output": "12"},
            {"input": "-3 8", "expected_output": "5"}
        ],
        "hidden_cases": [
            {"input": "100 250", "expected_output": "350"},
            {"input": "-50 -50", "expected_output": "-100"}
        ],
        "hints": [
            "Hint 1: Use the addition operator (+) to compute the sum of the two variables.",
            "Hint 2: Variables 'a' and 'b' contain the parsed integers. Calculate 'a + b'.",
            "Approach: Read the two values, add them together using 'a + b', and print the result directly to standard output.",
            "Solution:\nPython:\nprint(a + b)\n\nC++:\ncout << (a + b) << endl;\n\nJava:\nSystem.out.println(a + b);"
        ]
    },
    {
        "id": "py-02",
        "title": "Even or Odd Counter",
        "topic": "Conditionals",
        "difficulty": "Beginner",
        "points": 15,
        "description": "Given an integer N, print 'Even' if the number is divisible by 2, otherwise print 'Odd'.",
        "input_format": "A single integer N.",
        "output_format": "Print 'Even' or 'Odd' (case-sensitive).",
        "starter_codes": {
            "python": "import sys\nnum = int(sys.stdin.read().strip())\n# Write your if-else logic here\n",
            "javascript": "const fs = require('fs');\nconst num = parseInt(fs.readFileSync(0, 'utf-8').trim(), 10);\n// Write your logic here\n",
            "c": "#include <stdio.h>\n\nint main() {\n    int num;\n    scanf(\"%d\", &num);\n    // Your code here\n    return 0;\n}\n",
            "cpp": "#include <iostream>\nusing namespace std;\n\nint main() {\n    int num;\n    cin >> num;\n    // Your code here\n    return 0;\n}\n",
            "java": "import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int num = sc.nextInt();\n        // Your code here\n    }\n}\n"
        },
        "sample_cases": [
            {"input": "4", "expected_output": "Even"},
            {"input": "7", "expected_output": "Odd"}
        ],
        "hidden_cases": [
            {"input": "0", "expected_output": "Even"},
            {"input": "-15", "expected_output": "Odd"}
        ],
        "hints": [
            "Hint 1: Use the modulo operator (%) to find the remainder of division by 2.",
            "Hint 2: If a number is divisible by 2, 'num % 2 == 0'.",
            "Approach: Evaluate 'num % 2 == 0'. If true, print 'Even'. Otherwise, print 'Odd'.",
            "Solution:\nPython:\nif num % 2 == 0:\n    print('Even')\nelse:\n    print('Odd')"
        ]
    },
    {
        "id": "py-03",
        "title": "Reverse a String",
        "topic": "Strings & Loops",
        "difficulty": "Beginner",
        "points": 15,
        "description": "Given a string S from STDIN, print the reversed string.",
        "input_format": "A single string S.",
        "output_format": "The reversed string.",
        "starter_codes": {
            "python": "import sys\ntext = sys.stdin.read().strip()\n# Reverse and print the string\n",
            "javascript": "const fs = require('fs');\nconst text = fs.readFileSync(0, 'utf-8').trim();\n// Reverse and print\n",
            "c": "#include <stdio.h>\n#include <string.h>\n\nint main() {\n    char s[1000];\n    if (scanf(\"%s\", s) == 1) {\n        // Your code here\n    }\n    return 0;\n}\n",
            "cpp": "#include <iostream>\n#include <string>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    string s;\n    if (cin >> s) {\n        // Your code here\n    }\n    return 0;\n}\n",
            "java": "import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        if (sc.hasNext()) {\n            String s = sc.next();\n            // Your code here\n        }\n    }\n}\n"
        },
        "sample_cases": [
            {"input": "codeloop", "expected_output": "pooledoc"},
            {"input": "hello", "expected_output": "olleh"}
        ],
        "hidden_cases": [
            {"input": "racecar", "expected_output": "racecar"},
            {"input": "123456", "expected_output": "654321"}
        ],
        "hints": [
            "Hint 1: In Python, string slicing supports a negative step: text[::-1].",
            "Hint 2: In other languages, iterate backward from the last character index down to 0.",
            "Approach: Reverse the sequence of characters and print the resulting string.",
            "Solution:\nPython:\nprint(text[::-1])\n\nJavaScript:\nconsole.log(text.split('').reverse().join(''));"
        ]
    },
    {
        "id": "py-04",
        "title": "Factorial Calculation",
        "topic": "Loops & Functions",
        "difficulty": "Intermediate",
        "points": 20,
        "description": "Calculate the factorial of a non-negative integer N (N! = 1 * 2 * ... * N). Note: 0! is 1.",
        "input_format": "An integer N (0 <= N <= 20).",
        "output_format": "Print N!.",
        "starter_codes": {
            "python": "import sys\nn = int(sys.stdin.read().strip())\n# Compute factorial\n",
            "javascript": "const fs = require('fs');\nconst n = parseInt(fs.readFileSync(0, 'utf-8').trim(), 10);\n// Compute factorial\n",
            "c": "#include <stdio.h>\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n    // Your code here\n    return 0;\n}\n",
            "cpp": "#include <iostream>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    // Your code here\n    return 0;\n}\n",
            "java": "import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        // Your code here\n    }\n}\n"
        },
        "sample_cases": [
            {"input": "5", "expected_output": "120"},
            {"input": "0", "expected_output": "1"}
        ],
        "hidden_cases": [
            {"input": "1", "expected_output": "1"},
            {"input": "7", "expected_output": "5040"},
            {"input": "10", "expected_output": "3628800"}
        ],
        "hints": [
            "Hint 1: Initialize an accumulator variable with 1 (since 1 is the multiplicative identity).",
            "Hint 2: Loop from 1 up to N inclusive, multiplying the accumulator by each index.",
            "Approach: Maintain 'ans = 1'. Iterate 'for i in range(1, n + 1)' and update 'ans *= i'.",
            "Solution:\nPython:\nans = 1\nfor i in range(1, n + 1):\n    ans *= i\nprint(ans)"
        ]
    },
    {
        "id": "py-05",
        "title": "Find Maximum in Array",
        "topic": "Arrays / Lists",
        "difficulty": "Intermediate",
        "points": 20,
        "description": "Given a space-separated list of integers from STDIN, find and print the maximum value.",
        "input_format": "Space-separated integers (for example: '12 45 7 89 23').",
        "output_format": "The maximum integer value.",
        "starter_codes": {
            "python": "import sys\nnums = list(map(int, sys.stdin.read().strip().split()))\n# Find and print maximum\n",
            "javascript": "const fs = require('fs');\nconst nums = fs.readFileSync(0, 'utf-8').trim().split(/\\s+/).map(Number);\n// Find and print max\n",
            "c": "#include <stdio.h>\n\nint main() {\n    int val, max_val;\n    if (scanf(\"%d\", &max_val) == 1) {\n        while (scanf(\"%d\", &val) == 1) {\n            if (val > max_val) max_val = val;\n        }\n        printf(\"%d\\n\", max_val);\n    }\n    return 0;\n}\n",
            "cpp": "#include <iostream>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    int val, max_val;\n    if (cin >> max_val) {\n        while (cin >> val) {\n            if (val > max_val) max_val = val;\n        }\n        cout << max_val << endl;\n    }\n    return 0;\n}\n",
            "java": "import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        if (sc.hasNextInt()) {\n            int maxVal = sc.nextInt();\n            while (sc.hasNextInt()) {\n                int v = sc.nextInt();\n                if (v > maxVal) maxVal = v;\n            }\n            System.out.println(maxVal);\n        }\n    }\n}\n"
        },
        "sample_cases": [
            {"input": "12 45 7 89 23", "expected_output": "89"},
            {"input": "-10 -5 -20 -1", "expected_output": "-1"}
        ],
        "hidden_cases": [
            {"input": "100", "expected_output": "100"},
            {"input": "99 99 99", "expected_output": "99"}
        ],
        "hints": [
            "Hint 1: Initialize the maximum value with the first element of the list, not 0.",
            "Hint 2: Iterate through the elements and update the maximum when an element exceeds the current maximum.",
            "Approach: Set 'curr_max = nums[0]'. Compare each value and update. In Python, you can also use 'max(nums)'.",
            "Solution:\nPython:\nprint(max(nums))"
        ]
    },
    {
        "id": "py-06",
        "title": "Fibonacci Number",
        "topic": "Recursion & DP",
        "difficulty": "Advanced",
        "points": 30,
        "description": "Calculate the N-th Fibonacci number where Fib(0) = 0, Fib(1) = 1, and Fib(N) = Fib(N-1) + Fib(N-2).",
        "input_format": "An integer N (0 <= N <= 30).",
        "output_format": "Print the N-th Fibonacci number.",
        "starter_codes": {
            "python": "import sys\nn = int(sys.stdin.read().strip())\n# Compute N-th Fibonacci number\n",
            "javascript": "const fs = require('fs');\nconst n = parseInt(fs.readFileSync(0, 'utf-8').trim(), 10);\n// Compute Fibonacci\n",
            "c": "#include <stdio.h>\n\nint main() {\n    int n;\n    scanf(\"%d\", &n);\n    // Your code here\n    return 0;\n}\n",
            "cpp": "#include <iostream>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    // Your code here\n    return 0;\n}\n",
            "java": "import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        // Your code here\n    }\n}\n"
        },
        "sample_cases": [
            {"input": "6", "expected_output": "8"},
            {"input": "0", "expected_output": "0"}
        ],
        "hidden_cases": [
            {"input": "1", "expected_output": "1"},
            {"input": "10", "expected_output": "55"},
            {"input": "20", "expected_output": "6765"}
        ],
        "hints": [
            "Hint 1: Handle base cases: N = 0 yields 0, and N = 1 yields 1.",
            "Hint 2: An iterative solution with two variables computes the result in O(N) time with O(1) space.",
            "Approach: Maintain two variables 'a = 0' and 'b = 1'. Loop 'n - 1' times updating 'a, b = b, a + b'.",
            "Solution:\nPython:\nif n <= 0:\n    print(0)\nelif n == 1:\n    print(1)\nelse:\n    a, b = 0, 1\n    for _ in range(n - 1):\n        a, b = b, a + b\n    print(b)"
        ]
    },
    {
        "id": "py-07",
        "title": "Check Palindrome",
        "topic": "Strings",
        "difficulty": "Beginner",
        "points": 15,
        "description": "Given a single word, print 'True' if it reads the same backward as forward (case-insensitive), otherwise 'False'.",
        "input_format": "A single alphanumeric string.",
        "output_format": "Print 'True' or 'False'.",
        "starter_codes": {
            "python": "import sys\nword = sys.stdin.read().strip()\n# Check palindrome ignoring case\n",
            "javascript": "const fs = require('fs');\nconst word = fs.readFileSync(0, 'utf-8').trim();\n// Check palindrome\n",
            "c": "#include <stdio.h>\n#include <string.h>\n#include <ctype.h>\n\nint main() {\n    char s[1000];\n    if (scanf(\"%s\", s) == 1) {\n        // Your code here\n    }\n    return 0;\n}\n",
            "cpp": "#include <iostream>\n#include <string>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    string s;\n    if (cin >> s) {\n        // Your code here\n    }\n    return 0;\n}\n",
            "java": "import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String s = sc.next();\n        // Your code here\n    }\n}\n"
        },
        "sample_cases": [
            {"input": "Madam", "expected_output": "True"},
            {"input": "Code", "expected_output": "False"}
        ],
        "hidden_cases": [
            {"input": "racecar", "expected_output": "True"},
            {"input": "Level", "expected_output": "True"}
        ],
        "hints": [
            "Hint 1: Normalize the string by converting to lowercase using lower().",
            "Hint 2: Compare the normalized string against its reverse.",
            "Approach: Check 'clean == clean[::-1]'. Output 'True' or 'False'.",
            "Solution:\nPython:\nclean = word.lower()\nprint('True' if clean == clean[::-1] else 'False')"
        ]
    },
    {
        "id": "py-08",
        "title": "Count Vowels in Sentence",
        "topic": "Strings & Loops",
        "difficulty": "Beginner",
        "points": 15,
        "description": "Count how many vowels ('a', 'e', 'i', 'o', 'u', case-insensitive) appear in the input string.",
        "input_format": "A line of text.",
        "output_format": "The total count of vowels.",
        "starter_codes": {
            "python": "import sys\ntext = sys.stdin.read()\n# Count vowels\n",
            "javascript": "const fs = require('fs');\nconst text = fs.readFileSync(0, 'utf-8');\n// Count vowels\n",
            "c": "#include <stdio.h>\n#include <ctype.h>\n\nint main() {\n    char c;\n    int count = 0;\n    while ((c = getchar()) != EOF) {\n        // Your code here\n    }\n    printf(\"%d\\n\", count);\n    return 0;\n}\n",
            "cpp": "#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string s;\n    getline(cin, s);\n    // Your code here\n    return 0;\n}\n",
            "java": "import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String text = sc.hasNextLine() ? sc.nextLine() : \"\";\n        // Your code here\n    }\n}\n"
        },
        "sample_cases": [
            {"input": "Hello World", "expected_output": "3"},
            {"input": "CODELOOP", "expected_output": "4"}
        ],
        "hidden_cases": [
            {"input": "Rhythm", "expected_output": "0"},
            {"input": "AEIOU aeiou", "expected_output": "10"}
        ],
        "hints": [
            "Hint 1: Define a vowel lookup set: set('aeiou').",
            "Hint 2: Iterate over each character and increment the count when it is in the vowel set.",
            "Approach: Count matching characters with 'sum(1 for c in text.lower() if c in 'aeiou')'.",
            "Solution:\nPython:\nprint(sum(1 for c in text.lower() if c in 'aeiou'))"
        ]
    }
]

def get_problem_by_id(problem_id: str):
    for p in PRACTICE_PROBLEMS:
        if p["id"] == problem_id:
            return p
    return None
