function openTab(tabId) {
    // Hide all tab contents
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all buttons
    const buttons = document.querySelectorAll('.nav-btn');
    buttons.forEach(button => {
        button.classList.remove('active');
    });

    // Show the selected tab and set button to active
    document.getElementById(tabId).classList.add('active');
    
    // Find the button that called this and activate it
    event.currentTarget.classList.add('active');
}
